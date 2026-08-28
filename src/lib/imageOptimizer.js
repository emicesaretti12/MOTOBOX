/**
 * Image Optimizer Utility for MotoBox CRM
 * Client-Side WebP Canvas Compression + Direct CDN Delivery
 */

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || ''
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || ''

/**
 * Sanitizes a filename to safe ASCII alphanumeric characters
 */
function sanitizeFileName(name) {
  return name
    .replace(/\.[^/.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .substring(0, 32) || 'img'
}

/**
 * Compresses an image File locally in the browser using HTML5 Canvas.
 * Converts 5MB-10MB camera photos to ~80KB high-quality WebP.
 */
export async function compressImage(file, options = {}) {
  const {
    maxWidth = 1280,
    maxHeight = 1280,
    quality = 0.82,
    mimeType = 'image/webp'
  } = options

  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      return reject(new Error('El archivo no es una imagen válida'))
    }

    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Error al leer la imagen'))
    reader.onload = (e) => {
      const img = new Image()
      img.onerror = () => reject(new Error('Error al decodificar la imagen'))
      img.onload = () => {
        let width = img.width
        let height = img.height

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height)
          width = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, width, height)

        const outputMime = canvas.toDataURL(mimeType).startsWith(`data:${mimeType}`) ? mimeType : 'image/jpeg'
        const ext = outputMime === 'image/webp' ? 'webp' : 'jpg'

        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('Error al comprimir la imagen'))
          
          const cleanName = `${sanitizeFileName(file.name)}.${ext}`
          const compressedFile = new File([blob], cleanName, { type: outputMime })
          const dataUrl = canvas.toDataURL(outputMime, quality)

          resolve({
            blob,
            file: compressedFile,
            dataUrl,
            originalSize: file.size,
            compressedSize: blob.size,
            reductionPercent: Math.round((1 - blob.size / file.size) * 100)
          })
        }, outputMime, quality)
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Uploads image with full auto-optimization:
 * 1. Compresses locally in browser to lightweight WebP (~80KB)
 * 2. If Cloudinary unsigned preset is configured, uploads directly to Cloudinary
 * 3. Default / Fallback: Uploads ultra-optimized WebP directly to Supabase Public Storage (zero-config, ultra-fast)
 */
export async function uploadOptimizedImage(file, supabase, path = 'motos') {
  // Step 1: Compress locally in browser (reduces 10MB -> 80KB WebP)
  const { file: compressedFile, reductionPercent, compressedSize } = await compressImage(file, {
    maxWidth: 1280,
    maxHeight: 1280,
    quality: 0.82
  })

  console.log(`[Image Optimizer] 📉 Foto optimizada en el navegador: ${Math.round(compressedSize / 1024)} KB (-${reductionPercent}% de peso)`)

  // Step 2: If Cloudinary preset is configured, try direct unsigned upload
  if (CLOUD_NAME && UPLOAD_PRESET && UPLOAD_PRESET !== 'motobox') {
    try {
      const formData = new FormData()
      formData.append('file', compressedFile)
      formData.append('upload_preset', UPLOAD_PRESET)
      formData.append('folder', `motobox/${path}`)

      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
        method: 'POST',
        body: formData
      })

      if (res.ok) {
        const data = await res.json()
        const optimizedUrl = data.secure_url.replace('/upload/', '/upload/f_auto,q_auto,w_1200/')
        console.log('[Image Optimizer] ☁️ Subida directa a Cloudinary exitosa:', optimizedUrl)
        return { url: optimizedUrl, provider: 'cloudinary' }
      }
    } catch (err) {
      console.warn('[Image Optimizer] Fallback a Storage directo:', err)
    }
  }

  // Step 3: Direct WebP upload to Supabase Public Storage
  const cleanExt = compressedFile.name.split('.').pop() || 'webp'
  const safeFileName = `${path}/${Date.now()}_${sanitizeFileName(file.name)}.${cleanExt}`

  const { error: upErr } = await supabase.storage.from('motobox-public').upload(safeFileName, compressedFile, {
    upsert: true,
    contentType: compressedFile.type
  })
  if (upErr) throw upErr

  const { data: urlData } = supabase.storage.from('motobox-public').getPublicUrl(safeFileName)
  const publicUrl = urlData.publicUrl

  console.log('[Image Optimizer] ⚡ Foto WebP guardada y servida a máxima velocidad:', publicUrl)
  return { url: publicUrl, provider: 'webp-storage' }
}

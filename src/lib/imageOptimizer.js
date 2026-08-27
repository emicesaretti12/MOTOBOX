/**
 * Image Optimizer Utility for MotoBox CRM
 * Integrates Cloudinary (di9j6zwyz) + Client-Side WebP Canvas Compression
 */

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'di9j6zwyz'
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'motobox'

/**
 * Compresses an image File locally in the browser using HTML5 Canvas
 * Reduces 5MB-10MB photos to ~80KB before upload.
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
          
          const cleanName = file.name.replace(/\.[^/.]+$/, "") + `.${ext}`
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
 * Uploads image with full Cloudinary optimization:
 * 1. Compresses locally first
 * 2. Attempts Direct Cloudinary Upload (f_auto, q_auto)
 * 3. Fallback: Uploads to Supabase Storage and routes through Cloudinary Fetch CDN for automatic transformation
 */
export async function uploadOptimizedImage(file, supabase, path = 'motos') {
  // Step 1: Compress locally in browser
  const { file: compressedFile, reductionPercent, compressedSize } = await compressImage(file, {
    maxWidth: 1280,
    maxHeight: 1280,
    quality: 0.82
  })

  console.log(`[Cloudinary Optimizer] 📉 Imagen comprimida localmente: ${Math.round(compressedSize / 1024)} KB (-${reductionPercent}%)`)

  // Step 2: Try direct unsigned upload to Cloudinary
  if (CLOUD_NAME) {
    try {
      const formData = new FormData()
      formData.append('file', compressedFile)
      if (UPLOAD_PRESET) {
        formData.append('upload_preset', UPLOAD_PRESET)
      }
      formData.append('folder', `motobox/${path}`)

      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
        method: 'POST',
        body: formData
      })

      if (res.ok) {
        const data = await res.json()
        // Inject Cloudinary auto-format, auto-quality, and responsive width transformations
        const optimizedUrl = data.secure_url.replace('/upload/', '/upload/f_auto,q_auto,w_1200/')
        console.log('[Cloudinary Optimizer] ☁️ Subida directa exitosa a Cloudinary:', optimizedUrl)
        return { url: optimizedUrl, provider: 'cloudinary' }
      } else {
        const errJson = await res.json().catch(() => ({}))
        console.warn('[Cloudinary Optimizer] Intento de subida directa:', errJson.error?.message || res.statusText)
      }
    } catch (err) {
      console.warn('[Cloudinary Optimizer] Fallback a Cloudinary Fetch CDN:', err)
    }
  }

  // Step 3: Supabase Storage + Cloudinary Fetch CDN Delivery
  // Uploads optimized WebP to Supabase Storage and delivers through Cloudinary's global edge network
  const fileName = `${path}/${Date.now()}_${compressedFile.name}`
  const { error: upErr } = await supabase.storage.from('motobox-public').upload(fileName, compressedFile, {
    upsert: true,
    contentType: compressedFile.type
  })
  if (upErr) throw upErr

  const { data: urlData } = supabase.storage.from('motobox-public').getPublicUrl(fileName)
  const supabaseUrl = urlData.publicUrl

  // Wrap with Cloudinary Fetch CDN for automatic WebP/AVIF delivery and optimization
  const cloudinaryCdnUrl = CLOUD_NAME
    ? `https://res.cloudinary.com/${CLOUD_NAME}/image/fetch/f_auto,q_auto,w_1200/${encodeURIComponent(supabaseUrl)}`
    : supabaseUrl

  console.log('[Cloudinary Optimizer] 🚀 Entregando vía Cloudinary Fetch CDN:', cloudinaryCdnUrl)
  return { url: cloudinaryCdnUrl, provider: 'cloudinary-fetch' }
}

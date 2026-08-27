/**
 * Image Optimizer Utility for MotoBox CRM
 * 
 * 1. Automatic Client-Side Compression (Canvas + WebP/JPEG)
 *    Reduces high-res camera photos (5MB - 10MB) to ~80KB without visible quality loss.
 * 
 * 2. Cloudinary Upload Support (if configured)
 *    If VITE_CLOUDINARY_CLOUD_NAME is provided, uploads directly to Cloudinary with auto-format/auto-quality (f_auto, q_auto).
 */

/**
 * Compresses an image File using HTML5 Canvas
 * @param {File} file - Original image file
 * @param {Object} options - Compression options
 * @returns {Promise<{blob: Blob, file: File, dataUrl: string, originalSize: number, compressedSize: number}>}
 */
export async function compressImage(file, options = {}) {
  const {
    maxWidth = 1280,
    maxHeight = 1280,
    quality = 0.82,
    mimeType = 'image/webp'
  } = options

  return new Promise((resolve, reject) => {
    // If not an image, reject
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

        // Calculate aspect-ratio-preserving dimensions
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height)
          width = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        // Smooth image rendering
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, width, height)

        // Try WebP first, fallback to JPEG if browser doesn't support WebP export
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
 * Uploads image with auto-optimization:
 * - Compresses locally first
 * - Uploads to Cloudinary (if env vars set) or Supabase Storage (motobox-public)
 */
export async function uploadOptimizedImage(file, supabase, path = 'motos') {
  // 1. Local compression first
  const { file: compressedFile, reductionPercent, compressedSize } = await compressImage(file, {
    maxWidth: 1280,
    maxHeight: 1280,
    quality: 0.82
  })

  console.log(`[ImageOptimizer] 📉 Imagen optimizada: ${Math.round(compressedSize / 1024)} KB (${reductionPercent}% más liviana)`)

  // 2. Check if Cloudinary is configured via environment
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

  if (cloudName && uploadPreset) {
    try {
      const formData = new FormData()
      formData.append('file', compressedFile)
      formData.append('upload_preset', uploadPreset)
      formData.append('folder', `motobox/${path}`)

      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        body: formData
      })
      if (res.ok) {
        const data = await res.json()
        // Use Cloudinary automatic format & quality transformations
        const optimizedUrl = data.secure_url.replace('/upload/', '/upload/f_auto,q_auto,w_1200/')
        return { url: optimizedUrl, provider: 'cloudinary' }
      }
    } catch (err) {
      console.warn('[ImageOptimizer] Error en Cloudinary, usando Supabase Storage fallback:', err)
    }
  }

  // 3. Upload to Supabase Storage with optimized file
  const fileName = `${path}/${Date.now()}_${compressedFile.name}`
  const { error: upErr } = await supabase.storage.from('motobox-public').upload(fileName, compressedFile, {
    upsert: true,
    contentType: compressedFile.type
  })
  if (upErr) throw upErr

  const { data: urlData } = supabase.storage.from('motobox-public').getPublicUrl(fileName)
  return { url: urlData.publicUrl, provider: 'supabase' }
}

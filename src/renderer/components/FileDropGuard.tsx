import { useEffect } from 'react'

/** Dropping files, URLs or text onto the window does nothing and never navigates it. */
export default function FileDropGuard() {
  useEffect(() => {
    function ignore(event: DragEvent) {
      event.preventDefault()
    }
    window.addEventListener('dragover', ignore)
    window.addEventListener('drop', ignore)
    return () => {
      window.removeEventListener('dragover', ignore)
      window.removeEventListener('drop', ignore)
    }
  }, [])
  return null
}

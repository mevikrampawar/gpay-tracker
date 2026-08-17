import * as React from "react"

export type Route = string

function currentPath(): string {
  const h = window.location.hash
  if (!h || h === "#") return "/"
  return h.replace(/^#/, "")
}

export function navigate(path: string) {
  window.location.hash = path
}

export function useRoute(): Route {
  const [path, setPath] = React.useState<string>(currentPath)
  React.useEffect(() => {
    const onChange = () => setPath(currentPath())
    window.addEventListener("hashchange", onChange)
    return () => window.removeEventListener("hashchange", onChange)
  }, [])
  return path
}

import * as React from "react"

export type Route = string

const ROUTE_KEY = "gpay_last_route"

function currentPath(): string {
  const h = window.location.hash
  if (!h || h === "#") {
    const saved = sessionStorage.getItem(ROUTE_KEY)
    if (saved && saved !== "/") {
      window.location.hash = saved
      return saved
    }
    return "/"
  }
  const path = h.replace(/^#/, "")
  sessionStorage.setItem(ROUTE_KEY, path)
  return path
}

export function navigate(path: string) {
  window.location.hash = path
  sessionStorage.setItem(ROUTE_KEY, path)
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

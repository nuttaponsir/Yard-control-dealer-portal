// usePageTitle() — pages set a title/subtitle; the header reads it. (SHARED)
export function usePageTitle() {
  const title = useState<string>('page:title', () => 'JWD Autologic — Dealer Portal')
  const subtitle = useState<string>('page:subtitle', () => '')
  function set(t: string, s = '') {
    title.value = t
    subtitle.value = s
  }
  return { title, subtitle, set }
}

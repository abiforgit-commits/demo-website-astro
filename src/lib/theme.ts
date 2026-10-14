// Pages that use the light (white) design. Add a path here for each light page.
const lightPages = ["/about", "/services", "/contact"];

export function isLightPage(pathname: string) {
  return lightPages.includes(pathname);
}
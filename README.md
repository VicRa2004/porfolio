# Portafolio — Víctor Raúl García García

Portafolio personal construido con [Astro](https://astro.build). Sitio estático, sin frameworks de UI ni CSS de terceros.

## Desarrollo

Requiere Node.js ≥ 22.12 y pnpm.

```sh
pnpm install
pnpm dev       # http://localhost:4321
pnpm build     # genera ./dist
pnpm preview   # sirve la build localmente
```

## Estructura

```text
public/                    favicon y CV descargable (cv-victor-raul-garcia.pdf)
src/
├── assets/projects/       capturas de proyectos (optimizadas por astro:assets)
├── components/            secciones de la página e Icon.astro (SVG de Iconify en build)
├── data/                  contenido en JSON: datos personales, experiencia, habilidades…
├── layouts/Layout.astro   <head>, SEO, fuentes y tema claro/oscuro
├── pages/                 index y contacto
└── styles/global.css      tokens de diseño y estilos base
```

El contenido se edita en `src/data/*.json`. Para añadir una captura de proyecto, guarda la imagen en
`src/assets/projects/` y pon su nombre de archivo en el campo `image` de `projects.json`.

Las fuentes (Bricolage Grotesque, Instrument Sans y JetBrains Mono) se descargan en build y se sirven
desde el propio sitio mediante la API de fuentes de Astro.

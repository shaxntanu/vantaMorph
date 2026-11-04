# Vanta-Morph

A browser-based visual tool that transforms images into dynamic particle-based art and interactive motion effects. The current editor is a static, browser-only app: upload an image, adjust depth and motion, then copy an embeddable custom element or download a self-contained HTML file.

## Run locally

From the repository root, run Python's built-in server:

```powershell
python -m http.server 4173
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). No npm install or build is required.

## Deploy to Vercel

Import this GitHub repository in Vercel and use these settings:

- Framework preset: **Other**
- Build command: leave blank
- Output directory: `.`

The repository root is the static site root. It needs no environment variables or server functions. After connecting the repo, GitHub commits can trigger Vercel deployments.

## Use the particle element

1. Upload up to four images, then adjust depth, drift, splash, gather, the line direction, point size, tint, and particle overlays.
2. Choose **Copy embed code** and paste the generated `<particle-cloud>` markup into your website. The snippet uses the deployed Vanta-Morph URL for `particle-cloud.js`; the image and depth map are packed into data URLs.
3. Or choose **Download standalone HTML** to get one self-contained file with the image, depth map, and renderer.

The component is regular browser JavaScript/WebGL and can be embedded in HTML or a framework app that supports custom elements.

## Image processing and privacy

Images are decoded and processed locally in the browser; Vanta-Morph does not upload them. Browser-decodable image types, including SVG, are accepted up to 25 MB. Large images are downscaled for the particle renderer. FastDepth depth inference uses ONNX Runtime Web from jsDelivr; the model itself is included at `assets/fastdepth.onnx`. If the runtime is unavailable, the editor estimates depth from image luminance instead.

Generated embed markup includes the selected image and depth map. Treat the snippet like the image when sharing it.

## Attribution

The interaction and visual structure were reverse engineered from [Gather · 聚 Lite](https://gather.be-of-dao.com/). This project uses the FastDepth weights and an independently written editor and renderer; it does not copy Gather's application code. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for model and runtime notices.

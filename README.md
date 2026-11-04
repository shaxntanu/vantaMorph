# Vanta Morph

Vanta Morph turns images into interactive particle fields that react to pointer movement. Upload an image, adjust its depth and motion, then export the result as an embeddable `<particle-cloud>` element or standalone HTML.

Image processing runs in your browser. FastDepth estimates the image depth, with a luminance fallback if the model cannot load. WebGL renders the particles.

#!/usr/bin/env python3
"""Clean the lossy-webp halo from the official furina sprite.

Lossy WebP smears colors into semi-transparent edge pixels (the visible
"outline" around the character). This pass:
  1. kills near-transparent noise (alpha < 24 -> fully transparent),
  2. unpremultiplies the remaining semi-transparent pixels to remove the
     background-color halo,
  3. snaps near-opaque pixels to fully opaque.
Output is a lossless PNG served by the pet plugin in place of the webp.
"""
import os
import sys

try:
    import numpy as np
except ImportError:
    sys.exit('numpy required')

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE) if os.path.basename(HERE).lower() == 'tools' else HERE, 'pet-assets')
SRC = os.path.join(ASSETS, 'sprite.webp')
DST = os.path.join(ASSETS, 'sprite-clean.png')


def main():
    img = Image.open(SRC).convert('RGBA')
    arr = np.array(img).copy()
    alpha = arr[..., 3].astype(np.int32)

    semi_before = int(((alpha > 0) & (alpha < 255)).sum())

    # 1) unpremultiply every semi-transparent pixel: removes the
    #    background-color halo carried by lossy-webp edge pixels
    rgb = arr[..., :3].astype(np.float32)
    denom = np.maximum(alpha, 1)[..., None].astype(np.float32)
    fixed = np.clip(rgb * 255.0 / denom, 0, 255).astype(np.uint8)
    semi = (alpha > 0) & (alpha < 255)
    arr[semi, :3] = fixed[semi]

    # 2) hard-binarize the alpha channel (threshold 90): kills the soft
    #    noisy rim entirely, edges stay crisp after rescaling
    arr[alpha < 90, 3] = 0
    arr[alpha >= 90, 3] = 255

    out = Image.fromarray(arr)
    out.save(DST, 'PNG', optimize=True)

    alpha2 = arr[..., 3].astype(np.int32)
    semi_after = int(((alpha2 > 0) & (alpha2 < 255)).sum())
    size = os.path.getsize(DST)
    print(f'saved {DST} ({size} bytes)')
    print(f'semi-transparent pixels: {semi_before} -> {semi_after}')


if __name__ == '__main__':
    main()

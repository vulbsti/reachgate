# Hero image: prompts and command

`assets/hero.jpg` (1600x640, JPEG q86) was generated with gpt-6-luna through `codex exec` (ChatGPT
plan, a minimal `codex exec` call), then cropped to 2.5:1 with Pillow.
Four candidates (a-d); **d was picked**.

## Command

```bash
#!/usr/bin/env bash
# gen.sh OUT PROMPTFILE -> OUT (landscape 1536x1024) via codex image generation (gpt-6-luna, ChatGPT plan)
# A minimal codex exec call: landscape, no reference images, no crop.
set -uo pipefail
out=$1; prompt=$(cat "$2")
msg="Call your image generation tool directly, exactly once, landscape 1536x1024. Pass the image prompt below to the tool word for word: do not rewrite, shorten or add to it. Do not read any files or skills, do not run shell commands, do not copy or save anything, do not judge the result. Image prompt: $prompt"
wd=$(dirname "$(realpath "$out")")/work_$(basename "$out" .png)_$(date +%s%N); mkdir -p "$wd"
log=${out%.png}.log; t0=$(date +%s)
bash -ic "$(printf '%q ' codex exec --ignore-user-config --skip-git-repo-check -s read-only -m gpt-6-luna -c model_reasoning_effort=low -C "$wd" -- "$msg")" </dev/null > "$log" 2>&1
sid=$(grep -m1 -o 'session id: [0-9a-f-]*' "$log" | cut -d' ' -f3)
png=$(ls -t "$CODEX_IMAGES/$sid"/*.png 2>/dev/null | head -1)   # CODEX_IMAGES: codex's generated-images folder
[[ -n $png ]] && cp "$png" "$out"
echo "$(basename "$out") done in $(( $(date +%s)-t0 ))s exists=$([[ -s $out ]] && echo yes || echo no)"
```

```bash
./gen.sh cand_a.png a.txt; ./gen.sh cand_b.png b.txt; ./gen.sh cand_c.png c.txt; ./gen.sh cand_d.png d.txt
```

Crop and export (candidate d came back at 1774x887):

```python
from PIL import Image
im = Image.open('cand_d.png').convert('RGB')
im = im.crop((0, 96, 1774, 806)).resize((1600, 640), Image.LANCZOS)
im.save('assets/hero.jpg', quality=86, optimize=True, progressive=True)
```

PNG would have been 1.5 MB for the same pixels; the JPEG is about 150 KB.

## Which one and why

- **a** (light oak desk, green graph paper, letter-labelled states): clean and readable, but the
  lettered circles and evenly lit paper look a little too tidy, close to an illustration.
- **b** (portrait sheet taped to an off-white desk, window light): the most convincing photograph,
  but the sheet is portrait, so a 2.5:1 crop cuts the diagram.
- **c** (close-up on walnut, one straight red path): handsome, but the red path is a ruler-straight
  line through the middle, which reads as a diagram, and the crop clips the top loop.
- **d** (b's look, landscape sheet): picked. Real paper with smudges, tape and a crossed-out arrow,
  one wobbly red route from the start arrow to a single state ringed in red, the red pencil and
  a mechanical pencil below, and the left 40 percent is quiet desk in window-light shadows. The
  graph sits in the middle band, so the 2.5:1 crop keeps all of it. No legible words.

## Prompts

### a

Overhead photograph, shot straight down, of a plain light oak desk lit by soft natural window light coming from the upper left, late morning, gentle soft shadows. On the right half of the frame lies a single sheet of pale green engineering graph paper, slightly curled at one corner, faint fine grid, real paper fibre texture. On it a hand-drawn state machine diagram in grey graphite pencil: about fourteen small circles (states) connected by curved arrows (actions), drawn quickly but neatly by an engineer, with a few smudges and one erased line. A double circle on the left of the diagram marks the start state. One single path of five arrows, from the start state to one state near the far edge of the diagram, is traced over in red coloured pencil, and that final state is circled twice in red pencil, loosely, by hand. Tiny scribbled single-letter labels next to some circles, nothing readable as words. A red coloured pencil, sharpened, lies diagonally beside the sheet, and a small eraser with grey crumbs. The left half of the frame is calm, empty, softly lit wood grain with nothing on it. Photorealistic, shot on a 50mm lens, true colours, muted and warm, slight film grain, no text, no logos, no hands, no laptop, no glowing effects.

### b

Top-down documentary photograph of an engineer's desk, matte off-white linoleum desk surface, cool daylight from a window at the top of the frame casting long soft shadows. Right of centre: a sheet of cream graph paper with a faint blue grid, taped down with one strip of masking tape. Drawn on it in graphite pencil is a small state graph: a dozen hand-drawn circles joined by arrows that loop back and branch, a few arrows crossed out, light pencil smudging from the side of a hand. Exactly one route through the graph, from a circle marked with a small arrow-in "start" tick to a circle near the bottom right, has been gone over with red pencil, the strokes pressed harder and slightly wobbly, and the destination circle is ringed several times in red. A red pencil and a grey mechanical pencil lie parallel to the paper's right edge. The left 45 percent of the image is empty desk surface in soft even light, quiet negative space. Realistic, natural, unstaged, slight paper texture and pencil sheen, shallow depth of field so the far corners soften slightly. No legible words, no typography, no screens, no people.

### c

Close overhead photograph of a sheet of graph paper on a walnut desk, natural window light raking across from the right so the paper grain and the graphite strokes catch the light. The paper fills the right two thirds of the frame and runs off the top and bottom edges. A hand-drawn state machine in soft graphite pencil spreads across it: circles of slightly uneven size, arrows with small hand-drawn arrowheads, some arrows curving back to earlier circles, two tiny scribbled marks inside a few circles. One path of arrows from the leftmost double-ringed start circle across to a single circle on the far right is retraced firmly in red coloured pencil, and that one circle is circled in red with a quick loop that overshoots. A red pencil with a worn tip rests on the paper near the red circle. Left third of the frame: dark walnut wood, empty, in soft shadow. Photorealistic macro-ish still life, 35mm film look, honest muted colours, fine grain, no words, no text, no logos, no glow.

### d

Top-down documentary photograph of an engineer's desk, matte off-white desk surface, cool daylight from a window above the frame casting long soft diagonal shadows across the left side. On the right half of the frame, a sheet of cream graph paper with a faint blue grid, turned landscape and slightly askew, held by one strip of masking tape. Drawn on it in graphite pencil is a wide, shallow state graph spread left to right across the middle of the sheet: about twelve small hand-drawn circles joined by arrows that branch, loop back and cross, one arrow crossed out, light pencil smudges from the side of a hand. Exactly one route through the graph, from a circle on the left marked by a short incoming arrow, across to one circle on the right side of the sheet, has been gone over with red pencil, strokes pressed harder and slightly wobbly, and that destination circle is ringed several times in red. A red pencil and a grey mechanical pencil lie just below the sheet, parallel to its bottom edge. The whole drawing sits in the vertical middle of the frame with margin above and below. The left 45 percent of the image is empty desk surface in soft light and shadow, quiet negative space. Realistic, natural, unstaged, slight paper texture and pencil sheen. No legible words, no typography, no screens, no people.

# The README demo: the real reachgate CLI on the bundled examples.
# Record: docker run --rm -v "$PWD:/repo:ro" -v "$PWD/assets/src/demo/out:/vhs/out" reachgate-vhs /repo/assets/src/demo/demo.tape
Output "/vhs/out/demo.gif"

Set Shell "bash"
Set FontSize 15
Set Width 1180
Set Height 620
Set Padding 18
Set Framerate 15
Set TypingSpeed 28ms
Set Theme "GitHub Dark"

Hide
Type "cp -r /repo /work && cd /work && export PS1='\[\e[2m\]$\[\e[0m\] ' && clear"
Enter
Sleep 1s
Show

Type "# 1. Explore a small game's real engine: is it ever unwinnable?"
Enter
Sleep 400ms
Type "reachgate explore examples/dungeon/target.mjs"
Sleep 400ms
Enter
Sleep 3.5s

Type "reachgate replay examples/dungeon/target.mjs .reachgate/witnesses/no-softlock.json | tail -6"
Sleep 400ms
Enter
Sleep 4s

Hide
Type "clear"
Enter
Show

Type "# 2. The gate: record what's reachable, refactor, check again"
Enter
Sleep 400ms
Type "reachgate baseline examples/todo-reducer/target.mjs#fixed --quiet"
Sleep 400ms
Enter
Sleep 4s
Type "reachgate check examples/todo-reducer/target.mjs#regressed --quiet | head -14; echo exit=${PIPESTATUS[0]}"
Sleep 400ms
Enter
Sleep 7s

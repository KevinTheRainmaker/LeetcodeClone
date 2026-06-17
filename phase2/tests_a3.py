from sol_a3 import solve

tests = {
"A3-T1": ("4 4\nS..#\n..P#\n...#\n#D.#", 3),
"A3-T2": ("4 6\nS.P..#\n.#....\n..#D..\n....#.", 3),
"A3-T3": ("2 6\nS..P.#\n#...D#", 2),
"A3-T4": ("3 5\nS.P..\n..D..\n.....", -1),
"A3-T5": ("5 7\nS..#...\n.......\n..R.P.D\n.......\n.......", 3),
}
for name, (t, exp) in tests.items():
    got = solve(t)
    assert got == exp, (name, got, exp)
    print(name, "->", got)

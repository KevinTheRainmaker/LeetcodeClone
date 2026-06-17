from sol_a2 import solve

tests = {
"A2-T1": ("1 5 1 1\nS.P.D", 4),
"A2-T2": ("1 4 1 2\nSGPD", 5),
"A2-T3": ("1 6 2 1\nSGGP.D", 7),
"A2-T4": ("1 5 1 1\nSGGPD", -1),
"A2-T5": ("1 5 2 2\nSGPGD", 5),
"A2-T6": ("3 5 1 3\nSG..D\n.#.#.\n..GP.", 8),
}
for name, (t, exp) in tests.items():
    got = solve(t)
    assert got == exp, (name, got, exp)
    print(name, "->", got)

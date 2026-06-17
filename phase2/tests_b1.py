# B1 공개 테스트 — md 요약에서 재구성한 전체 입력 (정답은 md 표와 일치함을 검증)
from sol_b1 import solve

tests = {
"B1-T1 (기본 주간 75분)": ("""2 1 23:00
1 10:00 1234 NORMAL IN
1 11:15 1234 NORMAL OUT""", "1234 3500"),
"B1-T2 (야간 경계 걸침)": ("""2 1 23:00
1 21:00 5566 NORMAL IN
1 22:25 5566 NORMAL OUT""", "5566 3250"),
"B1-T3 (일 상한 도달)": ("""2 1 23:30
1 06:00 7777 NORMAL IN
1 23:00 7777 NORMAL OUT""", "7777 15000"),
"B1-T4 (자정 걸침 역일 분리)": ("""2 2 12:00
1 23:00 2222 NORMAL IN
2 01:00 2222 NORMAL OUT""", "2222 3250"),
"B1-T5 (경차 할인 내림)": ("""2 1 23:00
1 10:00 3333 COMPACT IN
1 11:15 3333 COMPACT OUT""", "3333 1750"),
"B1-T6 (다회 입출차 + 미출차 간주)": ("""5 1 23:00
1 09:00 1111 NORMAL IN
1 09:20 1111 NORMAL OUT
1 10:00 1111 NORMAL IN
1 10:50 1111 NORMAL OUT
1 22:50 9999 NORMAL IN""", "1111 3000\n9999 1000"),
}
for name, (t, exp) in tests.items():
    got = solve(t)
    assert got == exp, (name, got, exp)
    print(name, "->", repr(got))

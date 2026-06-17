from sol_b2 import solve as b2
from sol_b3 import solve as b3

b2_tests = {
"B2-T1 (기본 단일 요청)": """10 2 1
0 A 3 7""",
"B2-T2 (정원 1 → 승차 층 건너뜀)": """10 1 2
0 A 2 8
0 B 3 5""",
"B2-T3 (역방향 승객 동승)": """10 2 2
0 A 2 8
0 B 5 1""",
"B2-T4 (유휴 후 재가동)": """10 2 2
0 A 2 4
20 B 6 1""",
"B2-T5 (같은 층 다수 + 정원 + 요청 순서)": """10 2 3
0 A 3 9
0 B 3 6
0 C 3 5""",
"B2-T6 (방향 반전 SCAN)": """10 2 2
0 A 5 2
1 B 4 8""",
}
b3_tests = {
"B3-T1 (기본 직렬)": """1
2
AMERICANO 3
LATTE 5
2
0 A1 N 1 AMERICANO
0 A2 N 1 LATTE""",
"B3-T2 (병렬 2슬롯)": """2
2
AMERICANO 3
LATTE 5
3
0 A1 N 1 LATTE
0 A2 N 1 AMERICANO
1 A3 N 1 AMERICANO""",
"B3-T3 (우선 주문 새치기)": """1
2
AMERICANO 3
LATTE 5
3
0 A1 N 1 LATTE
1 A2 N 1 AMERICANO
2 A3 P 1 AMERICANO""",
"B3-T4 (묶음 주문)": """1
3
AMERICANO 3
LATTE 5
TEA 2
2
0 A1 N 3 AMERICANO LATTE TEA
5 A2 N 1 TEA""",
"B3-T5 (동시 가용 타이브레이크)": """2
1
AMERICANO 3
4
0 A1 N 1 AMERICANO
0 A2 N 1 AMERICANO
3 A3 N 1 AMERICANO
3 A4 N 1 AMERICANO""",
"B3-T6 (우선 다수 + 유휴 갭)": """2
2
AMERICANO 3
LATTE 5
4
0 A1 N 1 LATTE
0 A2 N 1 LATTE
1 A3 P 1 AMERICANO
10 A4 N 1 AMERICANO""",
}
for name, t in b2_tests.items():
    print(name); print(b2(t)); print()
for name, t in b3_tests.items():
    print(name); print(b3(t)); print()

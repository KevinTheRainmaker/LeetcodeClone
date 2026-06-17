# -*- coding: utf-8 -*-
"""phase2/main_study_problems_pilot.md 기반으로 A1~A3, B1~B3 문제를
data/phase2_problems.json, data/phase2_testcases.json, data/problem_sets.json에 반영한다.

- visible 테스트 = md의 공개 테스트 (빌드 시 레퍼런스 솔루션으로 전부 assert 검산)
- hidden 테스트 = md의 히든 설계 지침에 따라 제작, 기대값은 레퍼런스 솔루션으로 생성
- Phase1 파일(problems.json, testcases.json)은 건드리지 않는다.

실행: python build_data.py  (phase2/ 디렉터리에서)
"""
import json
from pathlib import Path

from sol_a1 import solve as a1
from sol_a2 import solve as a2
from sol_a3 import solve as a3
from sol_b1 import solve as b1
from sol_b2 import solve as b2
from sol_b3 import solve as b3

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

PY_STARTER = (
    "import sys\n"
    "\n"
    "def main():\n"
    '    data = sys.stdin.read().strip().split("\\n")\n'
    "    # TODO: 입력을 파싱해 문제를 해결하고, 결과를 print로 출력하세요.\n"
    "\n"
    "\n"
    "main()\n"
)
CPP_STARTER = (
    "#include <bits/stdc++.h>\n"
    "using namespace std;\n"
    "\n"
    "int main() {\n"
    "    // TODO: stdin에서 입력을 읽고 결과를 stdout으로 출력하세요.\n"
    "    return 0;\n"
    "}\n"
)

DESC_A1 = """N×M 격자 창고에서 배달 로봇이 물건을 픽업해 배달 지점까지 운반합니다. 미션 완료까지 걸리는 **최소 틱(tick) 수**를 구하세요. 불가능하면 `-1`을 출력합니다.

격자 기호:

| 기호 | 의미 |
|---|---|
| `.` | 빈 칸 (통행 가능) |
| `#` | 벽 (통행 불가) |
| `S` | 로봇 시작 위치 |
| `P` | 픽업 지점 |
| `D` | 배달 지점 |
| `C` | 충전소 |

`S`, `P`, `D`, `C`는 모두 통행 가능한 칸이며, 격자에 각각 정확히 1개 존재합니다 (`C`는 0개 이상).

**행동 규칙** — 매 틱마다 로봇은 다음 중 정확히 하나를 수행합니다:

1. **이동**: 상·하·좌·우 인접 칸으로 1칸 이동. 벽과 격자 밖으로는 이동할 수 없습니다.
2. **대기**: 제자리에 머무릅니다.

**배터리 규칙**:

- 시작 배터리와 최대 용량은 모두 `B`입니다.
- 이동 비용: 비적재 시 1, **적재 시 2**.
- 이동에 필요한 배터리가 부족하면 그 이동은 불가능합니다. 이동 후 배터리가 정확히 0이 되는 것은 허용됩니다.
- **충전소(`C`) 칸에서 대기**하면 틱당 +2 충전됩니다 (최대 `B`까지). 충전소를 지나치기만 하면 충전되지 않습니다. 충전소가 아닌 칸에서의 대기는 배터리 변화가 없습니다.

**픽업/배달 규칙**:

- `P` 칸에 위치하게 되는 즉시 자동으로 픽업됩니다 (별도 틱 소모 없음, 1회만).
- **적재 상태로 `D` 칸에 도착하는 순간의 틱 수**가 답입니다.

**입력 형식** (표준 입력):

```
N M B
(N줄의 격자, 각 줄 M글자)
```

제약: 1 ≤ N, M ≤ 20, 1 ≤ B ≤ 50

**출력 형식** (표준 출력): 최소 틱 수(정수), 불가능하면 `-1`"""

DESC_A2 = """N×M 격자 보안 구역에서 로봇이 물건을 픽업(`P`)해 배달 지점(`D`)까지 운반합니다. 구역에는 **주기적으로 여닫히는 보안문**이 있습니다. 미션 완료까지 걸리는 **최소 틱(tick) 수**를 구하세요. 불가능하면 `-1`을 출력합니다.

격자 기호:

| 기호 | 의미 |
|---|---|
| `.` | 빈 칸 (통행 가능) |
| `#` | 벽 (통행 불가) |
| `S` | 로봇 시작 위치 |
| `P` | 픽업 지점 |
| `D` | 배달 지점 |
| `G` | 보안문 |

`S`, `P`, `D`는 격자에 각각 정확히 1개 존재하며, `S`는 문 칸이 아닙니다.

**문 규칙**:

- 모든 문은 동일한 주기를 공유합니다: 틱 0부터 **O틱 동안 열림 → C틱 동안 닫힘**을 반복합니다. 즉 시각 t에 문이 열려 있을 조건은 `t mod (O+C) < O`입니다.
- 로봇은 **어떤 시각에든 닫힌 문 칸 위에 존재할 수 없습니다.** 즉, 문 칸으로 이동하려면 **도착 시각**에 열려 있어야 하고, 문 칸 위에서 대기하려면 **다음 시각**에도 열려 있어야 합니다.

**행동 규칙**: 매 틱 이동(상·하·좌·우 1칸) 또는 대기 중 하나를 수행합니다. 배터리는 없습니다.

**픽업/배달 규칙**:

- `P` 칸에 위치하게 되는 즉시 자동으로 픽업됩니다 (별도 틱 소모 없음, 1회만).
- **적재 상태로 `D` 칸에 도착하는 순간의 틱 수**가 답입니다.

**입력 형식** (표준 입력):

```
N M O C
(N줄의 격자)
```

제약: 1 ≤ N, M ≤ 20, 1 ≤ O, C ≤ 10

**출력 형식** (표준 출력): 최소 틱 수(정수), 불가능하면 `-1`"""

DESC_A3 = """N×M 빙판 창고에서 로봇이 물건을 픽업(`P`)해 배달 지점(`D`)까지 운반합니다. 바닥이 미끄러워 로봇은 방향을 선택하면 멈출 때까지 미끄러집니다. 미션 완료까지의 **최소 이동 횟수**(미끄러짐 1회 = 1틱)를 구하세요. 불가능하면 `-1`을 출력합니다.

격자 기호:

| 기호 | 의미 |
|---|---|
| `.` | 빈 칸 (빙판) |
| `#` | 벽 (통행 불가) |
| `S` | 로봇 시작 위치 |
| `P` | 픽업 지점 |
| `D` | 배달 지점 |
| `R` | 거친 바닥 |

`S`, `P`, `D`는 격자에 각각 정확히 1개 존재합니다.

**이동 규칙**:

- 매 틱 상·하·좌·우 중 한 방향을 선택하면, 로봇은 그 방향으로 **벽(`#`) 또는 격자 경계 직전 칸까지 미끄러집니다.**
- 단, 미끄러지는 도중 **거친 바닥(`R`)에 진입하면 그 칸에서 즉시 정지**합니다. (`R`은 진입할 때만 제동하며, 출발 칸으로서는 일반 칸과 같습니다.)
- 선택한 방향의 바로 옆 칸이 벽/경계면 그 이동은 불가능합니다 (틱 소모 없음).
- 대기 행동은 없습니다.

**픽업/완료 규칙**:

- `P`는 **미끄러져 지나치기만 해도** 픽업됩니다 (정지 불필요, 1회만).
- 완료는 적재 상태로 `D`에 **정지**해야 인정됩니다. 미끄러져 지나치는 것은 무효입니다. (픽업과 배달의 비대칭에 주의하세요.)

**입력 형식** (표준 입력):

```
N M
(N줄의 격자)
```

제약: 1 ≤ N, M ≤ 20

**출력 형식** (표준 출력): 최소 이동 횟수(정수), 불가능하면 `-1`"""

DESC_B1 = """주차장의 입·출차 이벤트 기록과 정산 시각이 주어집니다. 차량별 총 주차 요금을 계산하세요.

**요금 규칙**:

1. **기본요금**: 입차 1건당 1,000원 (최초 30분 포함). 주차 시간이 30분 이하여도 부과됩니다.
2. **추가요금**: 30분 초과분에 대해 **10분 블록 단위로 올림**, 블록당 500원.
   - 블록 i의 시작 시각 = 입차 시각 + 30분 + 10×i분 (i = 0, 1, 2, …).
3. **야간 할인**: 블록의 **시작 시각**이 야간(22:00 이상 또는 08:00 미만)이면 그 블록은 500원 대신 250원. 기본요금에는 야간 할인이 없습니다.
4. **일 상한**: 차량별로 **역일(calendar day)별 귀속 요금 합**에 15,000원 상한을 적용합니다.
   - 기본요금은 입차 시각이 속한 날에 귀속됩니다.
   - 각 블록은 그 블록의 시작 시각이 속한 날에 귀속됩니다.
5. **경차 할인**: 차종이 `COMPACT`인 차량은 일 상한 적용 **후** 전체 합계의 50% (원 미만 내림). 적용 순서: 야간 할인 → 일 상한 → 경차 할인.
6. **다회 입출차**: 같은 차량의 여러 세션은 각각 계산 후 합산합니다 (단, 일 상한은 역일별 누적에 적용).
7. **미출차 처리**: 정산 시각까지 출차 기록이 없는 차량은 **정산 시각에 출차한 것으로 간주**합니다.

**입력 형식** (표준 입력):

```
E (정산일) (정산시각 HH:MM)
(E줄의 이벤트: day HH:MM 차량번호 차종 IN|OUT)
```

- `day`는 1부터 시작하는 일 번호, 차종은 `NORMAL` 또는 `COMPACT`
- 이벤트는 시각 오름차순으로 주어지며, IN/OUT 쌍은 항상 정합적입니다.

**출력 형식** (표준 출력): 차량번호 오름차순으로 한 줄에 `차량번호 요금`"""

DESC_B2 = """F층 건물의 엘리베이터 1대가 **아래에 명시된 정책 그대로** 동작합니다. 승객 요청 목록이 주어질 때, 각 승객의 **하차 완료 시각**을 출력하세요. (최적 스케줄링이 아니라 주어진 정책의 충실한 시뮬레이션이 과제입니다.)

**정책 규칙** (번호 순서대로 평가):

1. 시작: 시각 0, 1층, 진행 방향 상행. 정원 K.
2. **정지**: 현재 층에 (a) 목적지가 이 층인 탑승자가 있거나, (b) 승차 가능한 대기 승객이 있으면 1틱 정지합니다. 정지 중 **하차가 먼저**, 그 후 빈 자리만큼 승차합니다. 하차 승객의 완료 시각 = 정지가 끝난 시각. 정지 종료 직후 같은 층을 재평가합니다 (정지 중 새 요청이 도착했으면 연속 정지 가능).
3. **승차 자격**: 요청 시각 ≤ 현재 시각인 대기 승객을 **요청 순서대로**, 정원 한도 내에서 태웁니다. **승객의 이동 방향은 따지지 않습니다** (반대 방향 승객도 탑승하며, 동승 후 정책대로 운행).
4. **목표 층** = 탑승자들의 목적지 ∪ 대기 승객(도착분)의 승차 층. 단, **정원이 가득 찼을 때는 승차 층을 목표에서 제외**합니다.
5. **방향**: 진행 방향 앞쪽에 목표 층이 있으면 유지, 없으면 반전합니다.
6. **이동**: 1층 이동 = 1틱.
7. **유휴**: 목표 층이 없고 미래 요청이 남아 있으면, 다음 요청 시각까지 현재 층에서 대기합니다 (방향 유지).

**입력 형식** (표준 입력):

```
F K R
(R줄의 요청: 시각 승객ID 출발층 도착층)
```

요청은 시각 오름차순. 출발층 ≠ 도착층. 1 ≤ K ≤ 10, R ≤ 50.

**출력 형식** (표준 출력): 승객ID 오름차순으로 한 줄에 `승객ID 완료시각`"""

DESC_B3 = """카페에서 바리스타 B명이 주문을 처리합니다. 메뉴별 제조 시간과 주문 목록이 주어질 때, 각 주문의 **완료 시각**을 출력하세요.

**처리 규칙**:

1. **묶음 주문**: 한 주문에 여러 잔이 포함될 수 있고, **한 명의 바리스타가 전부 연속으로 제조**합니다 (분담 불가). 주문 소요 시간 = 포함된 잔들의 제조 시간 합, 완료 시각 = 마지막 잔 완료 시각.
2. **대기열**: 도착했지만 배정되지 않은 주문은 대기열에 들어갑니다. 일반(`N`) 주문은 도착 순. **우선(`P`) 주문은 대기 중인 일반 주문보다 앞, 대기 중인 우선 주문보다는 뒤**에 삽입됩니다. 이미 제조 중인 작업을 중단시키지는 않습니다 (선점 없음).
3. **배정**: 바리스타가 가용해지면 대기열 맨 앞 주문을 받습니다. 같은 시각에 여러 바리스타가 가용하면 **낮은 번호부터** 배정합니다. 같은 시각에 도착과 가용이 동시 발생하면 도착을 먼저 대기열에 반영한 뒤 배정합니다.
4. 대기열이 비면 바리스타는 다음 주문 도착까지 유휴 상태가 됩니다.

**입력 형식** (표준 입력):

```
B
M
(M줄: 메뉴명 제조시간)
N
(N줄: 도착시각 주문ID 등급(P|N) 잔수 메뉴명들)
```

주문은 도착 시각 오름차순. B ≤ 5, N ≤ 50.

**출력 형식** (표준 출력): 주문ID 오름차순으로 한 줄에 `주문ID 완료시각`"""

# (stdin, 기대 출력) — 기대 출력은 md 공개 테이블 기준이며 아래에서 솔루션으로 전부 검산
PROBLEMS = [
    {
        "id": 211,
        "slug": "delivery-robot",
        "title": "배달 로봇",
        "category": "simulation",
        "solver": a1,
        "description": DESC_A1,
        "visible": [
            ("1 7 10\nS..P..D", "6"),
            ("1 7 8\nS.CP..D", "7"),
            ("1 5 6\nS.P.D", "4"),
            ("1 5 5\nS.P.D", "-1"),
            ("1 9 8\nS..C..P.D", "9"),
            ("3 5 9\nS.#.D\n..#P.\n..C..", "9"),
        ],
        "hidden": [
            "1 9 6\nS..CP.C.D",          # 충전소 2개, 경유 선택 비자명
            "1 8 8\nS.P.C..D",           # 픽업 후 충전 회귀가 필수
            "3 5 50\nS.#.D\n..#..\n..#P.",  # 배터리 충분해도 연결성 실패 -1
            "1 7 20\nD..S..P",           # P가 D 반대편 — 왕복 구조
        ],
    },
    {
        "id": 212,
        "slug": "security-zone-robot",
        "title": "보안 구역 로봇",
        "category": "simulation",
        "solver": a2,
        "description": DESC_A2,
        "visible": [
            ("1 5 1 1\nS.P.D", "4"),
            ("1 4 1 2\nSGPD", "5"),
            ("1 6 2 1\nSGGP.D", "7"),
            ("1 5 1 1\nSGGPD", "-1"),
            ("1 5 2 2\nSGPGD", "5"),
            ("3 5 1 3\nSG..D\n.#.#.\n..GP.", "8"),
        ],
        "hidden": [
            "1 8 2 3\nS.G.GP.D",   # 연속 문 2개 — 출발 위상 조절
            "1 6 3 2\nSGGP.D",     # 문 위 대기 경계
            "1 5 1 9\nSGP.D",      # 닫힘 구간이 길어 장시간 대기 최적
            "2 6 1 1\nS....P\n....D.",  # 문 없는 격자 (기본 BFS 회귀)
        ],
    },
    {
        "id": 213,
        "slug": "ice-warehouse-robot",
        "title": "빙판 창고 로봇",
        "category": "simulation",
        "solver": a3,
        "description": DESC_A3,
        "visible": [
            ("4 4\nS..#\n..P#\n...#\n#D.#", "3"),
            ("4 6\nS.P..#\n.#....\n..#D..\n....#.", "3"),
            ("2 6\nS..P.#\n#...D#", "2"),
            ("3 5\nS.P..\n..D..\n.....", "-1"),
            ("5 7\nS..#...\n.......\n..R.P.D\n.......\n.......", "3"),
        ],
        "hidden": [
            "4 8\nD...S...\n#.#...##\n.#....P.\n.#...R.#",        # 장거리 다중 반동 경로
            "5 5\n.#.#.\n..P..\nRR.#.\n.....\n..D.S",             # R 제동이 유일한 경로 (R 제거 시 -1)
            "3 5\n...P#\n....S\n#.D..",                           # 구조적 -1
            "5 7\n.P.....\n....#..\n.#...#.\n#......\nS..#D..",  # R 없는 회귀 케이스
        ],
    },
    {
        "id": 221,
        "slug": "parking-fee-system",
        "title": "주차장 정산 시스템",
        "category": "simulation",
        "solver": b1,
        "description": DESC_B1,
        "visible": [
            ("2 1 23:00\n1 10:00 1234 NORMAL IN\n1 11:15 1234 NORMAL OUT", "1234 3500"),
            ("2 1 23:00\n1 21:00 5566 NORMAL IN\n1 22:25 5566 NORMAL OUT", "5566 3250"),
            ("2 1 23:30\n1 06:00 7777 NORMAL IN\n1 23:00 7777 NORMAL OUT", "7777 15000"),
            ("2 2 12:00\n1 23:00 2222 NORMAL IN\n2 01:00 2222 NORMAL OUT", "2222 3250"),
            ("2 1 23:00\n1 10:00 3333 COMPACT IN\n1 11:15 3333 COMPACT OUT", "3333 1750"),
            (
                "5 1 23:00\n1 09:00 1111 NORMAL IN\n1 09:20 1111 NORMAL OUT\n1 10:00 1111 NORMAL IN\n1 10:50 1111 NORMAL OUT\n1 22:50 9999 NORMAL IN",
                "1111 3000\n9999 1000",
            ),
        ],
        "hidden": [
            "2 1 23:00\n1 10:00 4444 NORMAL IN\n1 10:30 4444 NORMAL OUT",  # 정확히 30분 (추가요금 0)
            "4 1 23:00\n1 07:20 1111 NORMAL IN\n1 08:15 1111 NORMAL OUT\n1 21:20 2222 NORMAL IN\n1 22:15 2222 NORMAL OUT",  # 블록 시작 정확히 08:00/22:00
            "2 1 23:30\n1 06:00 8888 COMPACT IN\n1 23:00 8888 COMPACT OUT",  # 경차+일 상한 동시 (할인 순서)
            "6 1 23:00\n1 09:00 5555 NORMAL IN\n1 09:00 5555 NORMAL OUT\n1 10:00 5555 NORMAL IN\n1 11:00 5555 NORMAL OUT\n1 12:00 5555 NORMAL IN\n1 13:30 5555 NORMAL OUT",  # 같은 날 3세션 + 0분 입출차
        ],
    },
    {
        "id": 222,
        "slug": "elevator-simulator",
        "title": "엘리베이터 시뮬레이터",
        "category": "simulation",
        "solver": b2,
        "description": DESC_B2,
        "visible": [
            ("10 2 1\n0 A 3 7", "A 8"),
            ("10 1 2\n0 A 2 8\n0 B 3 5", "A 9\nB 18"),
            ("10 2 2\n0 A 2 8\n0 B 5 1", "A 10\nB 18"),
            ("10 2 2\n0 A 2 4\n20 B 6 1", "A 5\nB 29"),
            ("10 2 3\n0 A 3 9\n0 B 3 6\n0 C 3 5", "A 11\nB 7\nC 21"),
            ("10 2 2\n0 A 5 2\n1 B 4 8", "A 17\nB 10"),
        ],
        "hidden": [
            "10 2 2\n0 A 3 7\n2 B 3 5",   # 정지 중 같은 층 새 요청 → 연속 정지
            "10 1 2\n0 A 2 5\n0 B 5 9",   # 하차 층 = 다른 승객 승차 층 (같은 정지에서 처리)
            "10 2 2\n0 A 1 3\n10 B 3 6",  # 유휴 중 도착한 요청이 현재 층
            "5 2 2\n0 A 5 1\n0 B 1 5",    # 최상층 경계 반전 + 역방향 동승
        ],
    },
    {
        "id": 223,
        "slug": "cafe-order-simulator",
        "title": "카페 주문 처리 시뮬레이터",
        "category": "simulation",
        "solver": b3,
        "description": DESC_B3,
        "visible": [
            ("1\n2\nAMERICANO 3\nLATTE 5\n2\n0 A1 N 1 AMERICANO\n0 A2 N 1 LATTE", "A1 3\nA2 8"),
            ("2\n2\nAMERICANO 3\nLATTE 5\n3\n0 A1 N 1 LATTE\n0 A2 N 1 AMERICANO\n1 A3 N 1 AMERICANO", "A1 5\nA2 3\nA3 6"),
            ("1\n2\nAMERICANO 3\nLATTE 5\n3\n0 A1 N 1 LATTE\n1 A2 N 1 AMERICANO\n2 A3 P 1 AMERICANO", "A1 5\nA2 11\nA3 8"),
            ("1\n3\nAMERICANO 3\nLATTE 5\nTEA 2\n2\n0 A1 N 3 AMERICANO LATTE TEA\n5 A2 N 1 TEA", "A1 10\nA2 12"),
            ("2\n1\nAMERICANO 3\n4\n0 A1 N 1 AMERICANO\n0 A2 N 1 AMERICANO\n3 A3 N 1 AMERICANO\n3 A4 N 1 AMERICANO", "A1 3\nA2 3\nA3 6\nA4 6"),
            ("2\n2\nAMERICANO 3\nLATTE 5\n4\n0 A1 N 1 LATTE\n0 A2 N 1 LATTE\n1 A3 P 1 AMERICANO\n10 A4 N 1 AMERICANO", "A1 5\nA2 5\nA3 8\nA4 13"),
        ],
        "hidden": [
            "1\n3\nAMERICANO 3\nLATTE 5\nTEA 2\n3\n0 A1 N 1 LATTE\n1 A2 P 1 AMERICANO\n2 A3 P 1 TEA",  # 우선 2건 시차 도착 (P 간 순서 유지)
            "1\n3\nAMERICANO 3\nLATTE 5\nTEA 2\n2\n0 A1 N 1 AMERICANO\n3 A2 N 1 TEA",  # 제조 완료 = 도착 동시각
            "1\n3\nAMERICANO 3\nLATTE 5\nTEA 2\n3\n0 A1 N 1 LATTE\n1 A2 P 2 AMERICANO TEA\n2 A3 N 1 AMERICANO",  # 묶음+우선 결합
            "3\n3\nAMERICANO 3\nLATTE 5\nTEA 2\n2\n0 A1 N 4 AMERICANO AMERICANO LATTE TEA\n0 A2 N 1 TEA",  # 대형 묶음 병렬 분담 금지
        ],
    },
]

NEW_IDS = [p["id"] for p in PROBLEMS]


def build():
    problems_out = []
    testcases_out = {}
    for p in PROBLEMS:
        solver = p["solver"]
        # 공개 테스트 검산 — 하나라도 불일치하면 빌드 중단
        for i, (stdin_text, expected) in enumerate(p["visible"], 1):
            got = str(solver(stdin_text))
            assert got == expected, (p["id"], f"T{i}", got, expected)
        visible = [
            {"stdin": s + "\n", "expected_output": e} for s, e in p["visible"]
        ]
        hidden = [
            {"stdin": s + "\n", "expected_output": str(solver(s))}
            for s in p["hidden"]
        ]
        problems_out.append(
            {
                "id": p["id"],
                "slug": p["slug"],
                "title": p["title"],
                "difficulty": "medium",
                "category": p["category"],
                "type": "cli-given",
                "description": p["description"],
                "examples": [
                    {"input": s, "output": e} for s, e in p["visible"]
                ],
                "starter": {"python": PY_STARTER, "cpp": CPP_STARTER},
            }
        )
        testcases_out[str(p["id"])] = {"visible": visible, "hidden": hidden}
    return problems_out, testcases_out


def main():
    problems_out, testcases_out = build()

    # phase2_problems.json: 기존 항목 유지, 새 ID는 교체(멱등) 후 추가
    pp_path = DATA / "phase2_problems.json"
    existing = json.loads(pp_path.read_text(encoding="utf-8"))
    existing = [p for p in existing if p["id"] not in NEW_IDS]
    pp_path.write_text(
        json.dumps(existing + problems_out, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    # phase2_testcases.json: 새 키 추가/교체
    tc_path = DATA / "phase2_testcases.json"
    tc = json.loads(tc_path.read_text(encoding="utf-8"))
    tc.update(testcases_out)
    tc_path.write_text(
        json.dumps(tc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    # problem_sets.json: set 1의 phase2ProblemIds만 교체 (phase1 problemIds 불변)
    ps_path = DATA / "problem_sets.json"
    ps = json.loads(ps_path.read_text(encoding="utf-8"))
    for s in ps["sets"]:
        if s["setId"] == 1:
            s["phase2ProblemIds"] = NEW_IDS
    ps_path.write_text(
        json.dumps(ps, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print("OK: problems", [p["id"] for p in problems_out])
    print("OK: testcase keys", sorted(testcases_out.keys()))
    print("OK: set1 phase2ProblemIds ->", NEW_IDS)


if __name__ == "__main__":
    main()

import sys

def _night(minute_of_day):
    return minute_of_day >= 22 * 60 or minute_of_day < 8 * 60

def solve(text):
    lines = text.strip().split('\n')
    first = lines[0].split()
    E, settle_day = int(first[0]), int(first[1])
    sh, sm = map(int, first[2].split(':'))
    settle_abs = (settle_day - 1) * 1440 + sh * 60 + sm
    cars = {}
    for i in range(1, E + 1):
        day, hhmm, cid, ctype, ev = lines[i].split()
        h, m = map(int, hhmm.split(':'))
        abs_t = (int(day) - 1) * 1440 + h * 60 + m
        car = cars.setdefault(cid, {'type': ctype, 'sessions': [], 'open': None})
        if ev == 'IN':
            car['open'] = abs_t
        else:
            car['sessions'].append((car['open'], abs_t))
            car['open'] = None
    out = []
    for cid in sorted(cars):
        car = cars[cid]
        sessions = list(car['sessions'])
        if car['open'] is not None:  # 미출차 → 정산 시각 출차 간주
            sessions.append((car['open'], settle_abs))
        daily = {}  # 역일 → 귀속 요금 합
        for tin, tout in sessions:
            daily[tin // 1440] = daily.get(tin // 1440, 0) + 1000  # 기본요금: 입차일 귀속
            over = max(0, (tout - tin) - 30)
            nblocks = (over + 9) // 10  # 10분 블록 올림
            for i in range(nblocks):
                bs = tin + 30 + 10 * i  # 블록 시작 시각
                fee = 250 if _night(bs % 1440) else 500  # 야간: 블록 시작 기준
                daily[bs // 1440] = daily.get(bs // 1440, 0) + fee
        total = sum(min(v, 15000) for v in daily.values())  # 일 상한
        if car['type'] == 'COMPACT':
            total //= 2  # 경차 할인 (상한 적용 후, 원 미만 내림)
        out.append(f"{cid} {total}")
    return '\n'.join(out)

if __name__ == '__main__':
    print(solve(sys.stdin.read()))

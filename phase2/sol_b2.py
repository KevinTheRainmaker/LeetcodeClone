import sys

def solve(text):
    lines = text.strip().split('\n')
    F, K, R = map(int, lines[0].split())
    reqs = []  # (time, id, frm, to, boarded?, done?)
    for i in range(1, R + 1):
        t, rid, frm, to = lines[i].split()
        reqs.append({'t': int(t), 'id': rid, 'frm': int(frm), 'to': int(to)})
    waiting = list(reqs)          # 입력(=요청 시각) 순서 유지
    onboard = []
    done = {}
    t, p, d = 0, 1, +1            # 시작: 1층, 상행
    while waiting or onboard:
        arrived = [r for r in waiting if r['t'] <= t]
        # 1) 현재 층 정지 판정: 하차 → 승차(요청 순, 정원 내)
        alights = [o for o in onboard if o['to'] == p]
        cap_after = K - (len(onboard) - len(alights))
        boards = [r for r in arrived if r['frm'] == p][:max(0, cap_after)]
        if alights or boards:
            for o in alights:
                onboard.remove(o)
                done[o['id']] = t + 1          # 완료 시각 = 정지 종료 시각
            for r in boards:
                waiting.remove(r)
                onboard.append(r)
            t += 1                              # 정지 1틱
            continue                            # 정지 직후 같은 층 재평가
        # 2) 목표 층 집계 (정원 초과 시 승차 층은 목표에서 제외)
        targets = {o['to'] for o in onboard}
        if len(onboard) < K:
            targets |= {r['frm'] for r in arrived}
        if not targets:
            t = min(r['t'] for r in waiting)    # 유휴: 다음 요청 시각으로 점프
            continue
        # 3) 방향 결정: 진행 방향에 목표가 있으면 유지, 없으면 반전
        if not any((f - p) * d > 0 for f in targets):
            d = -d
        # 4) 1층 이동 = 1틱
        t += 1
        p += d
    return '\n'.join(f"{r['id']} {done[r['id']]}" for r in sorted(reqs, key=lambda x: x['id']))

if __name__ == '__main__':
    print(solve(sys.stdin.read()))

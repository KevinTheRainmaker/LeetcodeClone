import sys

def solve(text):
    lines = text.strip().split('\n')
    idx = 0
    B = int(lines[idx]); idx += 1
    M = int(lines[idx]); idx += 1
    menu = {}
    for _ in range(M):
        name, dur = lines[idx].split(); idx += 1
        menu[name] = int(dur)
    N = int(lines[idx]); idx += 1
    orders = []
    for j in range(N):
        parts = lines[idx].split(); idx += 1
        t, oid, cls, cnt = int(parts[0]), parts[1], parts[2], int(parts[3])
        items = parts[4:4 + cnt]
        dur = sum(menu[it] for it in items)     # 한 주문은 한 바리스타가 연속 제조
        orders.append({'t': t, 'id': oid, 'cls': cls, 'dur': dur, 'idx': j})
    free = [0] * B                               # 바리스타별 작업 종료 시각
    queue, pending = [], sorted(orders, key=lambda o: (o['t'], o['idx']))
    done = {}
    t = 0
    remaining = len(orders)
    while remaining:
        while pending and pending[0]['t'] <= t:
            o = pending.pop(0)
            # 대기열 삽입: P(우선)는 대기 중인 N 앞, 대기 중인 P 뒤
            if o['cls'] == 'P':
                pos = len([q for q in queue if q['cls'] == 'P'])
                queue.insert(pos, o)
            else:
                queue.append(o)
        assigned = False
        for b in range(B):                       # 동시 가용 시 낮은 번호 우선
            if free[b] <= t and queue:
                o = queue.pop(0)
                free[b] = t + o['dur']
                done[o['id']] = t + o['dur']
                remaining -= 1
                assigned = True
        if assigned:
            continue
        cands = []
        if pending:
            cands.append(pending[0]['t'])
        if queue:
            cands.append(min(f for f in free if f > t))
        t = min(c for c in cands if c > t) if any(c > t for c in cands) else min(cands)
    return '\n'.join(f"{o['id']} {done[o['id']]}" for o in sorted(orders, key=lambda x: x['id']))

if __name__ == '__main__':
    print(solve(sys.stdin.read()))

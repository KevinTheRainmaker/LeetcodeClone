import sys
from collections import deque

def solve(text):
    lines = text.strip().split('\n')
    N, M, B = map(int, lines[0].split())
    grid = [list(lines[1 + i]) for i in range(N)]
    for r in range(N):
        for c in range(M):
            if grid[r][c] == 'S': sr, sc = r, c
            if grid[r][c] == 'P': pr, pc = r, c
            if grid[r][c] == 'D': dr, dc = r, c
    start = (sr, sc, (sr, sc) == (pr, pc), B)
    visited = {start}
    q = deque([start + (0,)])
    while q:
        r, c, carry, b, t = q.popleft()
        # 이동 (비적재 1 / 적재 2, 배터리 정확히 0 허용)
        cost = 2 if carry else 1
        for dr2, dc2 in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nr, nc = r + dr2, c + dc2
            if not (0 <= nr < N and 0 <= nc < M) or grid[nr][nc] == '#':
                continue
            nb = b - cost
            if nb < 0:
                continue
            ncarry = carry or (nr, nc) == (pr, pc)
            if ncarry and (nr, nc) == (dr, dc):
                return t + 1
            st = (nr, nc, ncarry, nb)
            if st not in visited:
                visited.add(st)
                q.append(st + (t + 1,))
        # 대기 (충전소에서만 +2, 상한 B)
        nb = min(B, b + 2) if grid[r][c] == 'C' else b
        st = (r, c, carry, nb)
        if st not in visited:
            visited.add(st)
            q.append(st + (t + 1,))
    return -1

if __name__ == '__main__':
    print(solve(sys.stdin.read()))

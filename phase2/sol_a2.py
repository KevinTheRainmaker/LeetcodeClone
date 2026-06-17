import sys
from collections import deque

def solve(text):
    lines = text.strip().split('\n')
    N, M, O, C = map(int, lines[0].split())
    L = O + C
    grid = [list(lines[1+i]) for i in range(N)]
    for r in range(N):
        for c in range(M):
            if grid[r][c] == 'S': sr, sc = r, c
            if grid[r][c] == 'P': pr, pc = r, c
            if grid[r][c] == 'D': dr, dc = r, c
    def ok(r, c, t):  # t 시각에 (r,c)에 존재 가능한가
        if grid[r][c] == '#': return False
        if grid[r][c] == 'G': return (t % L) < O
        return True
    start = (sr, sc, (sr, sc) == (pr, pc), 0)
    visited = {start}
    q = deque([start + (0,)])
    while q:
        r, c, carry, ph, t = q.popleft()
        nt = t + 1
        for dr2, dc2 in ((0,0),(0,1),(0,-1),(1,0),(-1,0)):  # 대기 + 4방향
            nr, nc = r + dr2, c + dc2
            if 0 <= nr < N and 0 <= nc < M and ok(nr, nc, nt):
                ncarry = carry or ((nr, nc) == (pr, pc))
                if ncarry and (nr, nc) == (dr, dc):
                    return nt
                st = (nr, nc, ncarry, nt % L)
                if st not in visited:
                    visited.add(st)
                    q.append(st + (nt,))
    return -1

if __name__ == '__main__':
    print(solve(sys.stdin.read()))

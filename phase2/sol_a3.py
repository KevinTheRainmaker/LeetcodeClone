import sys
from collections import deque

def solve(text):
    lines = text.strip().split('\n')
    N, M = map(int, lines[0].split())
    grid = [list(lines[1+i]) for i in range(N)]
    for r in range(N):
        for c in range(M):
            if grid[r][c] == 'S': sr, sc = r, c
            if grid[r][c] == 'P': pr, pc = r, c
            if grid[r][c] == 'D': dr, dc = r, c
    def blocked(r, c):
        return not (0 <= r < N and 0 <= c < M) or grid[r][c] == '#'
    def slide(r, c, carry, dr2, dc2):
        # 미끄러짐: 벽/경계 직전 또는 R 진입 시 정지. 통과 칸에서 P 픽업.
        if blocked(r + dr2, c + dc2):
            return None
        while True:
            nr, nc = r + dr2, c + dc2
            if blocked(nr, nc):
                break
            r, c = nr, nc
            if (r, c) == (pr, pc):
                carry = True
            if grid[r][c] == 'R':
                break
        return r, c, carry
    start = (sr, sc, (sr, sc) == (pr, pc))
    visited = {start}
    q = deque([start + (0,)])
    while q:
        r, c, carry, t = q.popleft()
        for dr2, dc2 in ((0,1),(0,-1),(1,0),(-1,0)):
            res = slide(r, c, carry, dr2, dc2)
            if res is None:
                continue
            nr, nc, ncarry = res
            if ncarry and (nr, nc) == (dr, dc):   # 적재 상태로 D에 '정지'해야 완료
                return t + 1
            st = (nr, nc, ncarry)
            if st not in visited:
                visited.add(st)
                q.append(st + (t + 1,))
    return -1

if __name__ == '__main__':
    print(solve(sys.stdin.read()))

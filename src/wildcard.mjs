// Thompson-style NFA: O(pattern length × input length), without regex backtracking.
function compileWildcard(pattern, mode) {
  if (!['filename', 'exclusion', 'workspace'].includes(mode)) throw new Error('Unknown wildcard mode.');
  const states = [];
  for (let offset = 0; offset < pattern.length; offset += 1) {
    if (mode === 'workspace' && pattern.startsWith('**/', offset)) {
      states.push({ kind: 'optional-directory' }, { kind: 'star', slash: true }, { kind: 'literal', value: '/' });
      offset += 2;
    } else if (pattern[offset] === '*') {
      const double = mode !== 'filename' && pattern[offset + 1] === '*';
      states.push({ kind: 'star', slash: mode === 'filename' || double });
      if (double) offset += 1;
    } else {
      states.push({ kind: 'literal', value: pattern[offset] });
    }
  }

  function closure(active) {
    for (let index = 0; index < states.length; index += 1) {
      if (!active[index]) continue;
      if (states[index].kind === 'star') active[index + 1] = 1;
      if (states[index].kind === 'optional-directory') {
        active[index + 1] = 1;
        active[index + 3] = 1;
      }
    }
  }

  return function matches(input) {
    let active = new Uint8Array(states.length + 1);
    let next = new Uint8Array(states.length + 1);
    active[0] = 1;
    closure(active);
    for (let offset = 0; offset < input.length; offset += 1) {
      const character = input[offset];
      next.fill(0);
      for (let index = 0; index < states.length; index += 1) {
        if (!active[index]) continue;
        const state = states[index];
        if (state.kind === 'literal' && state.value === character) next[index + 1] = 1;
        if (state.kind === 'star' && (state.slash
          ? !'\n\r\u2028\u2029'.includes(character)
          : character !== '/')) next[index] = 1;
      }
      closure(next);
      [active, next] = [next, active];
    }
    return active[states.length] === 1;
  };
}

export { compileWildcard };

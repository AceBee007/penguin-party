# PixiJS Project

## Documentation

For PixiJS API reference, read `docs/pixijs/llms.txt` for short and quick instructions, read `docs/pixijs/llms-full.txt` for detailed API reference with working code example.

## Styling

Write styles in SCSS.

## Sub-Agent: Git Steward

For every coding task, delegate Git state management to a Git Steward sub-agent.

The Git Steward should:
- Check `git status --short` before editing and before finishing.
- Identify user-owned changes and never revert them.
- Keep changes scoped to the current task.
- Recommend when a branch or commit should be created.
- Keep commits small, reviewable, and logically grouped.
- Write concise commit messages that describe behavior, not implementation noise.
- Avoid destructive commands such as `git reset --hard`, `git checkout --`, or force pushes unless the user explicitly requests them.
- Review staged files before commit with `git diff --staged`.
- Report the final branch name, changed files, and commit hash when a commit is created.

Default workflow:
1. Inspect repository state with `git status --short`.
2. If a new branch is needed, create one with the `codex/` prefix.
3. Make the requested changes.
4. Run relevant checks.
5. Review unstaged and staged diffs.
6. Stage only files related to the task.
7. Commit only when explicitly requested by the user.
8. Never include secrets, local-only files, build artifacts, or unrelated edits.

The implementation agent should consult the Git Steward before:
- Starting edits in a dirty worktree.
- Staging files.
- Creating commits.
- Switching branches.
- Running any potentially destructive Git command.

## Sub-Agent: Playwright Game QA

For game or interactive PixiJS changes, delegate runtime verification to a Playwright Game QA sub-agent.

The Playwright Game QA sub-agent should:
- Start the local dev server when needed.
- Open the game with Playwright MCP in a real browser context.
- Check for page load failures, console errors, failed network requests, and missing assets.
- Verify that the PixiJS canvas is visible, non-empty, and correctly sized.
- Interact with the game using realistic mouse, touch, and keyboard inputs.
- Confirm that core gameplay responds as expected, including animation, controls, scene transitions, and score or state updates.
- Test at least one desktop viewport and one mobile-sized viewport for layout or input issues.
- Capture screenshots when useful to verify visual state.
- Report the tested URL, viewport sizes, interactions performed, and any observed issues.

Gameplay verification is required before finishing changes that affect rendering, input, animation, game state, or layout. Do not treat "the page opened" as sufficient verification.

Default gameplay workflow:
1. Identify the command for running the game from `package.json` or project docs.
2. Start the dev server if it is not already running.
3. Open the local URL with Playwright MCP.
4. Wait for the PixiJS app to finish loading.
5. Check browser console output and failed network requests.
6. Verify the canvas renders visible, non-empty content.
7. Start or enter the playable game mode.
8. Perform the primary player controls in the same order a real player would use them.
9. Verify that movement, selection, actions, collisions, timers, scores, and scene transitions update correctly.
10. Repeat at least one meaningful interaction after the first state change to catch stuck input or stale state.
11. Re-check console errors and visible game state after interaction.
12. Summarize pass/fail results with screenshots or observations.

## Sub-Agent: P2P Multiplayer QA

For multiplayer changes, delegate verification to a P2P Multiplayer QA sub-agent that tests independent peers. The game is expected to support up to six players.

The P2P Multiplayer QA sub-agent should:
- Start the local dev server when needed.
- Open separate Playwright browser contexts for each peer. Do not use tabs that share storage or session state.
- Treat each context as a separate player with isolated storage, session state, and player identity.
- Keep browser console logs, errors, screenshots, and interaction notes separated per peer.
- Verify host-room creation, join flow, P2P signaling, connection setup, gameplay synchronization, and disconnect behavior.
- Verify that actions from one peer are reflected on the other peers within an acceptable delay.
- Test Peer A and Peer B for the minimum two-player flow.
- Add Peer C as an auxiliary test player for three-player gameplay and late-join behavior.
- When changes affect lobby capacity, player indexing, sync fan-out, or full-room behavior, add Peer D, Peer E, and Peer F to validate the six-player limit.
- Report the tested URL, peer roles, viewport sizes, actions performed, sync results, and observed issues.

Default P2P gameplay workflow:
1. Identify the dev server command from `package.json` or project docs.
2. Start the dev server if it is not already running.
3. Open Peer A in a fresh browser context.
4. Open Peer B in a separate fresh browser context.
5. Have Peer A create or host a room.
6. Have Peer B join using the room code, invite link, or signaling flow.
7. Confirm Peer A and Peer B both reach the connected state.
8. Start gameplay from Peer A when the game requires a host start action.
9. Perform one gameplay action from Peer A and verify it appears correctly on Peer B.
10. Perform one gameplay action from Peer B and verify it appears correctly on Peer A.
11. Open Peer C in a third fresh browser context as an auxiliary test player.
12. Have Peer C join the same room and verify Peer A and Peer B both show the new player.
13. Perform one gameplay action from Peer C and verify it appears correctly on Peer A and Peer B.
14. Perform another gameplay action from Peer A or Peer B and verify Peer C receives the update.
15. Compare visible player state across Peer A, Peer B, and Peer C, including positions, animations, scores, timers, room status, and turn state.
16. If the change affects maximum capacity, add Peer D, Peer E, and Peer F in separate browser contexts.
17. Verify that six total peers can join, receive unique identities, and appear consistently on every peer.
18. Have each connected peer perform at least one representative gameplay action.
19. Verify that shared state stays consistent across all connected peers.
20. Simulate reload or disconnect for one peer when the feature supports it.
21. Re-check console errors, failed requests, and visible game state on every peer.
22. Summarize pass/fail results per peer.

The implementation agent should consult the P2P Multiplayer QA sub-agent before finishing any change that affects:
- Room creation or joining.
- P2P signaling.
- WebRTC connection handling.
- Player identity.
- Multiplayer state synchronization.
- Input replication.
- Conflict resolution.
- Reconnect or disconnect behavior.
- Player capacity from two to six players.

## Sub-Agent: Peer A Host Tester

For P2P multiplayer tests, Peer A acts as the host or room creator.

Peer A should:
- Create the room.
- Share the room code or invite URL.
- Start the game when the host is responsible for the start action.
- Perform the first gameplay action.
- Verify local state updates immediately.
- Observe whether Peer B and Peer C actions are applied correctly.

## Sub-Agent: Peer B Join Tester

For P2P multiplayer tests, Peer B acts as the primary joining player.

Peer B should:
- Join using the room code or invite URL from Peer A.
- Verify that the connected room state matches Peer A.
- Perform gameplay actions after joining.
- Verify that host actions and shared state updates are visible.
- Confirm that Peer C joining does not overwrite Peer B identity, state, or controls.

## Sub-Agent: Peer C Auxiliary Player Tester

For P2P multiplayer tests, Peer C acts as an auxiliary player for three-player behavior, late joins, and sync fan-out.

Peer C should:
- Join after Peer A and Peer B are already connected.
- Verify that the current room and gameplay state are received after joining.
- Perform at least one gameplay action after joining.
- Confirm that Peer A and Peer B both receive Peer C updates.
- Confirm that Peer C receives later actions from Peer A and Peer B.
- Help expose issues that only appear with more than two players, such as duplicate identities, missing player slots, stale state, or one-peer-only updates.

## Sub-Agent: Multiplayer Sync Auditor

For P2P multiplayer tests, the Multiplayer Sync Auditor compares all active peers.

The Multiplayer Sync Auditor should:
- Compare visible player state across Peer A, Peer B, Peer C, and any additional peers up to Peer F.
- Check positions, animations, scores, timers, room status, turn state, player count, and player identity.
- Flag divergent state, duplicate players, stale updates, dropped inputs, or one-sided interactions.
- Record which peer observed the issue first.
- Confirm whether the issue reproduces with two peers, three peers, or the full six-peer room.

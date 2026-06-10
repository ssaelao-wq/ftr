# **Engineering & Behavioral Rules (RULES.md)**

### Rule #1 — Deep Investigation First (Anti-Assumption)

> **Trace the root cause before patching symptoms.**

- Before writing any code or making any edit, trace the full execution flow of the affected area.
- Never patch a surface symptom without understanding why it occurs.
- If the root cause is not yet clear, investigate further rather than guessing.

---

### Rule #2 — Side Effect Analysis

> **Analyze whether an update affects unrelated modules before committing to it.**

- Before applying any change, list all modules, components, or documents that the change could touch.
- Explicitly confirm that unrelated modules are not broken by the proposed edit.
- If a side effect is discovered mid-edit, stop and report it before proceeding.

---

### Rule #3 — No Cleanup

> **Strictly forbidden from removing, "cleaning up," or refactoring code unrelated to the specific requirement.**

- Only touch what the current task explicitly requires.
- Do not rename variables, restructure files, remove comments, or reformat code outside the task scope — even if it looks "messy."
- Cleanup must be a separate, explicitly approved task.

---

### Rule #4 — Logic Integrity

> **Do not change any program logic that is not explicitly required by the current task.**

- If the task says "fix the button label", do not also change the button's click handler.
- If the task says "update the phase note", do not restructure surrounding paragraphs.
- Logic changes require explicit instruction. Implicit improvements are not permitted.

---

### Rule #5 — Fix Once Policy

> **If two attempts at a specific logic fix fail, STOP. Find a completely new architectural approach.**

- After one failed attempt, reassess the approach — do not just retry the same method.
- After two failed attempts on the same specific issue, halt and propose a fundamentally different solution before making another edit.
- This prevents iterative patching loops that waste time and introduce new bugs.

---

### Rule #6 — Surgical Output

> **Always return the entire updated function or block including its surrounding context for a clean update.**

- When editing code, return the complete containing function or section — not just the changed line in isolation.
- Include enough surrounding context that the change can be located and applied unambiguously.
- Never return a partial snippet that requires the reader to guess where it belongs.

---

### Rule #7 — Grading Protocol

> **NEVER change Thai 4.0 grading logic without checking `lib/grades.js` first.**

- Any feature or fix that touches grade calculation, grade display, or grade-related data must first verify the current logic in `lib/grades.js`.
- Changes to grading logic must be explicitly approved before implementation.
- This rule exists because grading errors have direct consequences for students and institutions.

---

### Rule #8 — Premium Aesthetics

> **Ensure all UI updates are modern, vibrant, and feature smooth micro-animations. No simple MVPs.**

- Every UI component must meet a premium visual standard: curated colour palettes, smooth transitions, hover states, and micro-animations where appropriate.
- Placeholder or "good enough" UI is not acceptable at any stage — the first version must already look polished.
- Reference the design principles in `VIDE_PRD.md §4.5` (Zero-Assumption Design) when making UI decisions.

---

### Rule #9 — Strict Type Safety

> **Enforce high-fidelity TypeScript types. Avoid `any`.**

- All new TypeScript code must use explicit, precise types.
- `any` is forbidden unless accompanied by a comment explaining why it is unavoidable and approved by the task owner.
- Type aliases and interfaces should be defined in dedicated type files, not inline in implementation files.

---

### Rule #10 — Token Efficiency (Model Routing)

> **Automatically switch to "Flash Mode" during implementation tasks to minimise token consumption without sacrificing logic integrity.**

- **Flash Mode:** Concise, surgical output. Return only what is needed — the changed function, the corrected section, the answer to the question. No preamble, no re-summary of unchanged content.
- **Standard Mode:** Used for design discussions, PRD writing, and planning sessions where full context is needed.
- The AI should self-select the mode based on task type. Implementation = Flash. Planning/design = Standard.

---

### Rule #11 — Verified Completion (Double-Check Policy)

> **"Completed is not Done — Verified is Done."**

- Before reporting task success, use `view_file` on the modified lines (or run the relevant tests) to physically confirm the change is present and matches the intended logic.
- Never assume a tool call succeeded without validation.
- If the verification reveals a mismatch, fix it immediately before reporting completion.
- Report: what was changed, what line(s) were verified, and the verified content.

---

### Rule #12 — Memory Persistence (Continuous Handover)

> **Always log completed work and architectural decisions to `MEMORY.md` before ending a session.**

- Every time a task, feature, or significant debugging session is completed, append a concise summary of the work, modified files, and key decisions to `MEMORY.md`.
- Never rely solely on chat history or ephemeral context for project continuity.
- Ensure the next assistant or developer can read `MEMORY.md` and immediately understand the current state of the codebase.

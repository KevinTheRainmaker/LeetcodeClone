# Explanation Gate — Implementation Specification

## 1. Overview

The Explanation Gate is a component that requires users to explain AI-generated code before they can apply or execute it. The gate evaluates user explanations against pre-defined rubric items and provides structured feedback on two dimensions: **Sufficiency** (whether all required rubric items are addressed) and **Correctness** (whether the explanations are factually accurate).

The gate does NOT ask questions or initiate dialogue. It receives a user explanation, evaluates it against rubric items, and returns structured feedback. The user decides what to do with that feedback (re-explain, consult Generator, re-read code, etc.).

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Frontend                          │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  Code    │  │ Generator│  │ Explanation Gate  │  │
│  │  Editor  │  │  Chat    │  │  Panel           │  │
│  │          │  │  Panel   │  │  - Explanation    │  │
│  │          │  │          │  │    input box      │  │
│  │          │  │          │  │  - Rubric feedback│  │
│  │          │  │          │  │  - Unlock status  │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────┘
         │               │                │
         ▼               ▼                ▼
┌─────────────────────────────────────────────────────┐
│                   Backend                           │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  Gate Evaluator Service                      │   │
│  │  - Receives: user explanation + rubric items  │   │
│  │  - Calls: OpenRouter LLM API                 │   │
│  │  - Returns: per-item evaluation              │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  Gate State Manager                          │   │
│  │  - Tracks: lock/unlock per code block        │   │
│  │  - Tracks: attempt count per gate session    │   │
│  │  - Tracks: rubric fulfillment status         │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  Logging Service                             │   │
│  │  - All gate events with timestamps           │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

The Gate Evaluator is a separate service from the Generator. It uses the same OpenRouter API but with its own system prompt and endpoint logic. The Generator chat panel and the Explanation Gate panel are independent UI components. Both are visible simultaneously (split view or tab view), but they do not share conversation context.

---

## 3. Gate Trigger Conditions

### When the gate activates

The gate activates when the user attempts to **apply AI-generated code to the editor** or **run AI-generated code**. Specifically:

1. User clicks "Apply to Editor" on a Generator code response → gate activates
2. User clicks "Run" after applying AI-generated code that has not been explained → gate activates
3. User manually copies code from Generator chat and pastes into editor → detect via clipboard monitoring or text similarity check against recent Generator responses, then activate gate on next "Run"

### When the gate does NOT activate

1. User-written code (not from Generator) → no gate
2. Code that has already been explained and unlocked → no gate on re-run
3. Trivial modifications to already-unlocked code (e.g., changing a variable name) → no gate
4. Generator responses that contain only text (no code blocks) → no gate

### Complexity-based gate intensity

Evaluate the complexity of AI-generated code and adjust gate intensity accordingly.

**Complexity scoring (computed automatically):**

```python
def compute_complexity(code_block: str) -> str:
    """Returns 'low', 'medium', or 'high'"""
    lines = [l for l in code_block.strip().split('\n') if l.strip() and not l.strip().startswith('#')]
    loc = len(lines)

    # Count nesting depth
    max_indent = max((len(l) - len(l.lstrip())) for l in lines) // 4 if lines else 0

    # Count definitions
    has_function = any(l.strip().startswith('def ') for l in lines)
    has_class = any(l.strip().startswith('class ') for l in lines)

    # Count control flow
    control_keywords = ['if ', 'elif ', 'else:', 'for ', 'while ', 'try:', 'except ', 'with ']
    control_count = sum(1 for l in lines for kw in control_keywords if kw in l)

    if loc <= 3 and control_count == 0 and not has_function:
        return 'low'
    elif loc <= 15 and max_indent <= 2 and not has_class:
        return 'medium'
    else:
        return 'high'
```

**Gate behavior by complexity:**

| Complexity | Gate behavior                                                                  |
| ---------- | ------------------------------------------------------------------------------ |
| `low`      | Auto-pass. No explanation required. Log the skip event.                        |
| `medium`   | Require explanation. Evaluate against core rubric items only (What + Why).     |
| `high`     | Require explanation. Evaluate against all rubric items (What + Why + What-if). |

---

## 4. Rubric System

### Rubric item structure

Each coding task has a set of pre-defined rubric items stored in a JSON configuration. Rubric items are authored by researchers before the experiment, based on the Bloom's Taxonomy for CS and Shen & Tamkin's code comprehension framework.

```json
{
  "task_id": "task_03",
  "rubric_items": [
    {
      "id": "R1",
      "dimension": "code_reading",
      "level": "what",
      "description": "User can explain what the function takes as input and what it returns",
      "required": true
    },
    {
      "id": "R2",
      "dimension": "code_reading",
      "level": "what",
      "description": "User can trace the execution flow for a typical input",
      "required": true
    },
    {
      "id": "R3",
      "dimension": "conceptual_understanding",
      "level": "why",
      "description": "User can explain why a dictionary is used instead of a list for counting",
      "required": true
    },
    {
      "id": "R4",
      "dimension": "conceptual_understanding",
      "level": "why",
      "description": "User can explain why the sorting step is necessary for the expected output",
      "required": true
    },
    {
      "id": "R5",
      "dimension": "debugging",
      "level": "what_if",
      "description": "User can predict behavior when input contains duplicates or is empty",
      "required": false
    },
    {
      "id": "R6",
      "dimension": "debugging",
      "level": "what_if",
      "description": "User can identify what breaks if the type check is removed",
      "required": false
    }
  ],
  "unlock_policy": {
    "medium_complexity": ["R1", "R2", "R3", "R4"],
    "high_complexity": ["R1", "R2", "R3", "R4", "R5", "R6"]
  }
}
```

`required: true` items must be Sufficient AND Correct for unlock. `required: false` items are evaluated and feedback is given, but they do not block unlock.

### Dynamic rubric generation for Phase 1

In Phase 1, users solve many different problems and AI generates varied solutions. Pre-defining rubrics for every possible AI response is impractical. For Phase 1 (baseline collection), the gate is NOT active. For Phase 2 (main experiment), the coding tasks are fixed and limited (1-2 tasks), so rubrics can be pre-defined by researchers.

However, if dynamic rubric generation is needed in the future (e.g., for deployment), the system should support an optional mode where rubric items are generated by a separate LLM call that analyzes the AI-generated code and produces rubric items in the same JSON schema. This is NOT used in the main experiment but should be architecturally supported.

---

## 5. Gate Evaluator — LLM Prompt Design

### System prompt

```
You are an Explanation Gate evaluator for a coding education research study. Your role is to evaluate whether a user's explanation of a code snippet adequately addresses specific rubric items.

You will receive:
1. The AI-generated code that the user is trying to use
2. A set of rubric items, each with an ID, dimension, level, and description
3. The user's explanation of the code

For each rubric item, evaluate the user's explanation on two independent dimensions:

SUFFICIENCY: Did the user's explanation address this rubric item at all?
- "sufficient": The explanation contains content that addresses this item
- "insufficient": The explanation does not address this item or only mentions it in passing without substance

CORRECTNESS: Is the user's explanation factually accurate for this item?
- "correct": The explanation is factually accurate
- "incorrect": The explanation contains a factual error or misconception
- "not_applicable": The item was not addressed (insufficient), so correctness cannot be evaluated

IMPORTANT RULES:
- Evaluate each rubric item independently using pointwise evaluation
- Base your evaluation strictly on what the user wrote, not on what they might know
- Do not infer understanding beyond what is explicitly stated
- An explanation can be sufficient but incorrect (user addressed the topic but got it wrong)
- An explanation can be insufficient and correct for what little was said
- Be strict but fair. Surface-level restatements of the code (e.g., "it loops through the list") without explaining WHY or HOW do not count as sufficient for "why" level items

Respond ONLY with valid JSON in the following format, no other text:
{
  "evaluations": [
    {
      "rubric_id": "R1",
      "sufficiency": "sufficient" | "insufficient",
      "correctness": "correct" | "incorrect" | "not_applicable",
      "feedback": "One sentence explaining the evaluation result to the user"
    }
  ]
}
```

### User message format

````
CODE TO EXPLAIN:
```python
{ai_generated_code}
````

RUBRIC ITEMS:
{rubric_items_json}

USER'S EXPLANATION:
{user_explanation}

````

### OpenRouter API call

```python
async def evaluate_explanation(
    code: str,
    rubric_items: list[dict],
    user_explanation: str
) -> dict:
    response = await openrouter_client.chat.completions.create(
        model="anthropic/claude-sonnet-4-20250514",  # or whatever model is configured
        messages=[
            {"role": "system", "content": GATE_SYSTEM_PROMPT},
            {"role": "user", "content": format_evaluation_request(code, rubric_items, user_explanation)}
        ],
        temperature=0.0,  # deterministic evaluation
        max_tokens=2000,
        response_format={"type": "json_object"}
    )
    return parse_evaluation_response(response)
````

Use `temperature=0.0` for evaluation consistency. The model should be configurable but default to the same tier as the Generator.

---

## 6. Shallow Explanation Detection

Before sending the explanation to the LLM evaluator, perform client-side or server-side checks for shallow explanation patterns.

### Copy-paste detection

```python
def detect_copy_paste(user_explanation: str, generator_responses: list[str], code_block: str) -> dict:
    """
    Check if user explanation is copied from Generator responses or is just
    a line-by-line reading of the code.
    """
    result = {"is_shallow": False, "reason": None}

    # Check similarity against recent Generator responses
    for response in generator_responses[-5:]:  # last 5 Generator messages
        similarity = compute_text_similarity(user_explanation, response)
        if similarity > 0.7:
            result = {"is_shallow": True, "reason": "generator_copy"}
            break

    # Check if explanation is just code tokens rearranged
    code_tokens = set(tokenize(code_block))
    explanation_tokens = set(tokenize(user_explanation))
    overlap = len(code_tokens & explanation_tokens) / max(len(explanation_tokens), 1)
    if overlap > 0.6 and len(user_explanation.split()) < len(code_block.split()) * 1.5:
        result = {"is_shallow": True, "reason": "code_reading"}

    return result
```

### Handling shallow explanations

If a shallow explanation is detected, prepend a note to the gate feedback BEFORE the rubric evaluation results:

| Reason           | Feedback message                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generator_copy` | "It looks like this explanation closely matches the AI assistant's response. Please try explaining in your own words what this code does and why." |
| `code_reading`   | "This explanation reads like a line-by-line description of the code. Could you explain the overall purpose and the reasoning behind the approach?" |

The shallow explanation flag is logged but does NOT prevent evaluation. The LLM evaluator still runs and provides rubric-level feedback. The shallow explanation note is an additional UI hint shown above the evaluation results.

---

## 7. Gate State Management

### State per code block

```typescript
interface GateSession {
  id: string; // unique gate session ID
  codeBlockId: string; // ID of the AI-generated code block
  codeContent: string; // the actual code
  complexity: "low" | "medium" | "high";
  status: "locked" | "unlocked";
  unlockType: "auto" | "full" | "partial" | "minimum" | "max_attempts" | null;
  applicableRubricIds: string[]; // rubric items applicable to this gate
  attempts: GateAttempt[]; // history of all attempts
  createdAt: timestamp;
  unlockedAt: timestamp | null;
}

interface GateAttempt {
  attemptNumber: number;
  userExplanation: string;
  shallowDetection: { is_shallow: boolean; reason: string | null };
  evaluations: RubricEvaluation[];
  timestamp: timestamp;
}

interface RubricEvaluation {
  rubricId: string;
  sufficiency: "sufficient" | "insufficient";
  correctness: "correct" | "incorrect" | "not_applicable";
  feedback: string;
}
```

### Unlock logic

```python
def determine_unlock(session: GateSession) -> tuple[bool, str]:
    """
    Returns (should_unlock, unlock_type)
    """
    # Auto-pass for low complexity
    if session.complexity == 'low':
        return True, 'auto'

    # Max attempts reached
    if len(session.attempts) >= MAX_ATTEMPTS:  # MAX_ATTEMPTS = 5
        return True, 'max_attempts'

    latest = session.attempts[-1]
    required_ids = session.applicable_rubric_ids

    # Check each required rubric item
    all_sufficient = True
    all_correct = True
    has_any_sufficient = False

    for eval in latest.evaluations:
        if eval.rubric_id not in required_ids:
            continue
        if eval.sufficiency == 'sufficient':
            has_any_sufficient = True
            if eval.correctness == 'incorrect':
                all_correct = False
        else:
            all_sufficient = False

    # Full unlock: all required items are sufficient AND correct
    if all_sufficient and all_correct:
        return True, 'full'

    # Partial unlock: all required items are sufficient but some incorrect
    # User addressed everything but has misconceptions
    if all_sufficient and not all_correct:
        return True, 'partial'

    # Not ready to unlock
    return False, None
```

**Unlock type semantics:**

| Unlock type    | Meaning                                       | UI behavior                                                                                         |
| -------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `auto`         | Low complexity, no explanation needed         | Code applies immediately. Small toast notification.                                                 |
| `full`         | All required items sufficient and correct     | "All items addressed correctly. Code unlocked."                                                     |
| `partial`      | All items addressed but some have errors      | "Code unlocked. Note: some parts of your explanation may contain inaccuracies. See feedback above." |
| `minimum`      | Reserved for future use                       | -                                                                                                   |
| `max_attempts` | 5 attempts exhausted without full sufficiency | "Maximum attempts reached. Code unlocked. Unaddressed items are listed above."                      |

### Maximum attempts

Set `MAX_ATTEMPTS = 5`. This is lower than the original 10-turn design because the gate is not a dialogue. Each attempt is a full explanation submission and evaluation cycle, which is more cognitively demanding than a single chat turn. 5 attempts provides enough opportunity to improve while preventing frustration.

---

## 8. Frontend UI Specification

### Gate panel layout

The Explanation Gate panel appears as a third panel alongside the Code Editor and Generator Chat, or as an overlay/modal that slides in when triggered.

```
┌─────────────────────────────────────────────────┐
│  Explanation Gate                          [x]  │
│─────────────────────────────────────────────────│
│                                                 │
│  📋 Code to explain:                           │
│  ┌─────────────────────────────────────────┐   │
│  │ def remove_duplicates(lst):             │   │
│  │     return sorted(set(lst))             │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  Explain this code in your own words:          │
│  ┌─────────────────────────────────────────┐   │
│  │                                         │   │
│  │  (text input area)                      │   │
│  │                                         │   │
│  └─────────────────────────────────────────┘   │
│                              [Submit Explanation]│
│                                                 │
│  ─── Evaluation Results ───                    │
│                                                 │
│  ✅ Code Reading: Sufficient, Correct          │
│     Function takes a list and returns a sorted │
│     list with duplicates removed.              │
│                                                 │
│  ⚠️ Conceptual Understanding: Insufficient     │
│     The explanation does not address why set()  │
│     was chosen for deduplication or the         │
│     trade-off with order preservation.          │
│                                                 │
│  ── Debugging: Not yet evaluated ──            │
│                                                 │
│  Attempt 1 of 5                                │
│                                                 │
└─────────────────────────────────────────────────┘
```

### UI states

1. **Locked state.** "Apply to Editor" and "Run" buttons are disabled (grayed out) for the relevant code block. Gate panel is visible with explanation input.

2. **Evaluating state.** After user submits explanation, show loading spinner with "Evaluating your explanation..." text. Disable submit button.

3. **Feedback state.** Show evaluation results per rubric dimension. If not unlocked, explanation input remains active for re-submission. Show attempt counter ("Attempt 2 of 5").

4. **Unlocked state.** Show unlock message with unlock type. "Apply to Editor" and "Run" buttons become active. Gate panel can be dismissed.

### Status indicators per rubric dimension

```
✅  Sufficient, Correct      — green check
⚠️  Sufficient, Incorrect    — yellow warning
❌  Insufficient              — red X (correctness shown as N/A)
⬜  Not yet evaluated         — gray (not addressed in current attempt)
```

### Explanation history panel (sidebar)

Show a compact history of all gate sessions for the current task.

```
📋 Explanation History
├─ sort_data()        ✅ Unlocked (full, 2 attempts)
├─ parse_csv()        ✅ Unlocked (full, 1 attempt)
├─ handle_missing()   ⚠️ Unlocked (partial, 3 attempts)
└─ compute_stats()    🔒 Locked (in progress)
```

---

## 9. Logging Specification

All gate events must be logged server-side with timestamps for research analysis.

### Event types

```typescript
// Gate triggered
{
  event: 'gate_triggered',
  timestamp: ISO8601,
  sessionId: string,
  taskId: string,
  codeBlockId: string,
  codeContent: string,
  complexity: 'low' | 'medium' | 'high',
  triggerSource: 'apply_button' | 'run_button' | 'paste_detected'
}

// Low-complexity auto-pass
{
  event: 'gate_auto_pass',
  timestamp: ISO8601,
  sessionId: string,
  codeBlockId: string,
  complexity: 'low'
}

// Explanation submitted
{
  event: 'explanation_submitted',
  timestamp: ISO8601,
  sessionId: string,
  attemptNumber: number,
  userExplanation: string,
  shallowDetection: { is_shallow: boolean, reason: string | null },
  wordCount: number,
  timeSpentMs: number  // time between gate activation (or previous feedback) and this submission
}

// Evaluation completed
{
  event: 'evaluation_completed',
  timestamp: ISO8601,
  sessionId: string,
  attemptNumber: number,
  evaluations: [
    {
      rubricId: string,
      dimension: string,
      level: string,
      sufficiency: string,
      correctness: string,
      feedback: string
    }
  ],
  llmLatencyMs: number
}

// Gate unlocked
{
  event: 'gate_unlocked',
  timestamp: ISO8601,
  sessionId: string,
  unlockType: 'auto' | 'full' | 'partial' | 'max_attempts',
  totalAttempts: number,
  totalTimeMs: number,  // from gate_triggered to gate_unlocked
  finalRubricStatus: [
    { rubricId: string, sufficiency: string, correctness: string }
  ]
}

// User navigated to Generator during active gate
{
  event: 'generator_visit_during_gate',
  timestamp: ISO8601,
  sessionId: string,
  gateAttemptNumber: number  // which attempt they were on when they switched
}
```

### Generator interaction logging during gate

When a gate is active (locked), continue logging all Generator chat interactions with a flag `during_active_gate: true`. This captures the "explanation → gap discovery → Generator re-query → re-explanation" loop, which is a key analysis target.

```typescript
// Existing Generator log events should include:
{
  event: 'generator_message_sent',
  timestamp: ISO8601,
  taskId: string,
  messageContent: string,
  during_active_gate: boolean,  // ADD THIS FLAG
  active_gate_session_id: string | null  // ADD THIS
}
```

---

## 10. API Endpoints

### POST /api/gate/evaluate

Request:

```json
{
  "session_id": "gate_abc123",
  "task_id": "task_03",
  "code_block_id": "code_xyz",
  "code_content": "def remove_duplicates(lst):\n    return sorted(set(lst))",
  "user_explanation": "This function takes a list...",
  "attempt_number": 1,
  "generator_recent_responses": ["...", "..."]
}
```

Response:

```json
{
  "session_id": "gate_abc123",
  "attempt_number": 1,
  "shallow_detection": {
    "is_shallow": false,
    "reason": null,
    "message": null
  },
  "evaluations": [
    {
      "rubric_id": "R1",
      "dimension": "code_reading",
      "level": "what",
      "sufficiency": "sufficient",
      "correctness": "correct",
      "feedback": "Function's input/output behavior is correctly described."
    },
    {
      "rubric_id": "R3",
      "dimension": "conceptual_understanding",
      "level": "why",
      "sufficiency": "insufficient",
      "correctness": "not_applicable",
      "feedback": "The explanation does not address why set() was chosen for deduplication."
    }
  ],
  "unlock": {
    "should_unlock": false,
    "unlock_type": null,
    "message": null
  },
  "attempts_remaining": 4
}
```

### GET /api/gate/status/{task_id}

Returns all gate sessions for a task with their current status. Used to render the Explanation History panel.

### GET /api/gate/rubric/{task_id}

Returns the rubric items configured for a task. Used for admin/researcher inspection.

---

## 11. Configuration

All tunable parameters should be in a config file, not hardcoded.

```json
{
  "gate": {
    "enabled": true,
    "max_attempts": 5,
    "complexity_thresholds": {
      "low_max_lines": 3,
      "low_max_control_flow": 0,
      "medium_max_lines": 15,
      "medium_max_nesting": 2
    },
    "shallow_detection": {
      "enabled": true,
      "generator_similarity_threshold": 0.7,
      "code_token_overlap_threshold": 0.6
    },
    "llm": {
      "provider": "openrouter",
      "model": "anthropic/claude-sonnet-4-20250514",
      "temperature": 0.0,
      "max_tokens": 2000
    },
    "ui": {
      "panel_position": "right",
      "show_history": true,
      "show_attempt_counter": true
    }
  }
}
```

---

## 12. Condition Management (Treatment vs Control)

The gate is only active for Treatment condition participants. This is controlled by a participant-level flag.

```python
def should_activate_gate(participant_id: str) -> bool:
    participant = get_participant(participant_id)
    return participant.condition == 'treatment' and is_phase_2()
```

For Control condition and all of Phase 1, the gate is completely invisible. No gate panel, no explanation prompts, no lock indicators. The UI should be identical to the Treatment condition minus the gate components.

For Treatment condition in Phase 2, the gate activates as specified above.

---

## 13. Error Handling

| Error                                     | Handling                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| LLM API timeout (>15s)                    | Retry once. If second attempt fails, show "Evaluation temporarily unavailable. Please try again." Keep gate locked. |
| LLM returns invalid JSON                  | Retry with same input. If fails again, log error and force-unlock with `unlock_type: 'error'`.                      |
| LLM rate limit                            | Queue the request with exponential backoff. Show "Evaluation queued, please wait..."                                |
| User closes browser during active gate    | Persist gate state server-side. On reconnect, restore the gate session in its last state.                           |
| Code block modified after gate activation | Invalidate current gate session. Re-trigger gate with new code content.                                             |

---

## 14. Testing Checklist

- [ ] Low complexity code auto-passes without showing gate panel
- [ ] Medium complexity code shows gate with What + Why rubric items only
- [ ] High complexity code shows gate with all rubric items
- [ ] Submitting a thorough, correct explanation unlocks with `full` type
- [ ] Submitting a sufficient but incorrect explanation unlocks with `partial` type
- [ ] Submitting an insufficient explanation does NOT unlock, shows specific feedback
- [ ] 5th attempt force-unlocks with `max_attempts` type
- [ ] Copy-pasted Generator response triggers shallow detection message
- [ ] Generator chat remains accessible during active gate
- [ ] Generator interactions during active gate are logged with `during_active_gate: true`
- [ ] Unlocked code can be re-run without re-triggering gate
- [ ] New AI code response triggers a new gate session
- [ ] Gate state persists across page refresh
- [ ] Control condition participants never see gate UI
- [ ] All gate events are logged with correct timestamps
- [ ] Explanation History panel updates in real time

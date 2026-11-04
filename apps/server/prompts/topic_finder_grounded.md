TASK: Generate {{COUNT}} video ideas for a YouTube channel.

INPUTS
- Keywords / topic seed: {{KEYWORDS}}
- Niche description (who the channel is, what it covers): {{NICHE}}
- Output language (all human-readable text): {{LANGUAGE}}
- Video format: {{FORMAT}}
- Channel style preset: {{STYLE_NAME}}
- Style description:
"""
{{STYLE_DESCRIPTION}}
"""
- Ideas to avoid (already saved or produced — do not repeat or paraphrase): {{EXCLUDE}}

REAL YOUTUBE DATA (last 90 days, top by views for each keyword group; numbers are real — never invent others)
{{EVIDENCE}}
Fields: id, g = keyword group index, t = title, v = views, subs = channel subscribers, x = outlier (views / subscribers), d = age in days, s = is Shorts.

PROCESS (think silently, output only JSON)
1. Study which REAL videos over-performed (high x, high v at small subs) and what core question, framing and packaging they share.
2. Expand the keywords into 15–25 sub-angles that fit the niche and the style preset.
3. Keep angles with a strong core question, enough documented material and proven demand in the real data. Do NOT copy real titles — create new, specific angles.
3b. Look at every angle through the ORIGINALITY LENSES and use a different lens for different ideas: L1 Uncanny normal · L2 Trade-off / cost of a trait · L3 Domino cascade · L4 Follow the money (economics of X) · L5 ELI5 analogy · L6 Inversion · L7 Before the standard (life before X) · L8 Anomaly vs consensus · L9 Translation trap / content gap · L10 Hidden world · L11 Turning point · L12 Truth stranger than fiction · L13 Validation · L14 Permission · L15 Scale shock · L16 Constrained counterfactual · L17 Modern echo · L18 Human micro-detail · L19 Timeline of a body/process · L20 Era immersion · L21 Domain collision · L22 Own experiment.
3c. Write the emotional core for each idea: "This video will make the viewer feel ___ because ___". If you can't write it, drop the idea.
4. Score every idea 1–10 for curiosity, demand (use the real data), visual potential, evergreen value and factual safety, AND fill the 100-point scorecard (each 0–5): demand ×3, emotion ×3, gap (originality) ×3, packaging clarity ×2 (≤60 chars + 0–3 word thumbnail readable in 0.3 s), retention engine ×2 (question → answer → deeper question), visual ×2 (≥5 unforgettable shots + a thumbnail shot), evidence ×2 (primary sources, studies, data), evergreen ×1, feasibility ×2. Return the best {{COUNT}}, sorted by total score.

RULES
- evidence_ids: 2–3 ids of REAL videos from the list above that prove demand for this specific idea (same topic, question or mechanic). Only ids from the list. If the list is empty, return [].
- keyword_group: index g of the keyword group the idea belongs to (0 if no data).
- why: 1–2 sentences explaining why it will work, referencing the real evidence (views, outlier) when available. Mention videos by a short quoted title, NEVER by id.
- hook: the first 1–2 sentences the narrator says (cold open).
- audience: who exactly will watch it (1 sentence).
- thumbnail.visual: focal subject, composition, lighting, colors; thumbnail.text: 0–4 words that add to the title.
- Keep enum values in English exactly as in the schema.

JSON SCHEMA
{
  "ideas": [
    {
      "title": "string, in {{LANGUAGE}}, 40–70 chars",
      "alt_titles": ["string", "string"],
      "core_question": "string",
      "hook": "string",
      "angle": "mystery | mechanism | consequence | comparison | human_story | what_if | timeline | myth_vs_fact",
      "lens": "L1..L22",
      "emotional_core": "string, in {{LANGUAGE}}: what the viewer will feel and why",
      "summary": "2–3 sentences",
      "why": "string",
      "audience": "string",
      "thumbnail": { "visual": "string", "text": "string" },
      "evidence_ids": ["id"],
      "keyword_group": 0,
      "search_keywords": ["5–8 keywords"],
      "fact_check": ["claims to verify"],
      "scores": { "curiosity": 0, "demand": 0, "visual": 0, "evergreen": 0, "factual_safety": 0 },
      "scorecard": { "demand": 0, "emotion": 0, "gap": 0, "packaging": 0, "retention": 0, "visual": 0, "evidence": 0, "evergreen": 0, "feasibility": 0 }
    }
  ]
}

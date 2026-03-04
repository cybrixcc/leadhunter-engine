# Article Evaluation Prompt

You are a content quality analyst. Your task is to extract specific information from the generated article to verify it meets requirements.

## Article to Evaluate
```tsx
{{ARTICLE_CONTENT}}
```

## Brief (Original Requirements)
Title: {{TITLE}}
Key Points Required:
{{KEY_POINTS}}

Sources Available:
{{SOURCES}}

## Extract These Facts

Answer each question with a specific value. Do NOT rate or evaluate - just extract facts.

### 1. Word Count
Count the approximate number of words in the visible text content (exclude code, imports, class names).
Format: Just the number (e.g., "1847")

### 2. Key Points Coverage
List which key points from the brief ARE covered in the article.
Format: Numbered list of covered points

### 3. Key Points Missing
List which key points from the brief are NOT covered in the article.
Format: Numbered list of missing points (or "None" if all covered)

### 4. Statistics Used
List all statistics, percentages, and numbers mentioned in the article with their claimed source.
Format:
- "72% of accounts..." - source: Expandi
- "3-4x lower limits..." - source: not cited
(List each statistic found)

### 5. Internal Links Found
List all internal links (href starting with "/" or relative paths).
Format: List of paths found

## Output Format

Respond with a JSON object:
```json
{
  "wordCount": 1847,
  "keyPointsCovered": ["point 1 summary", "point 2 summary"],
  "keyPointsMissing": ["point 3 summary"],
  "statistics": [
    {"stat": "72%", "context": "accounts restricted", "source": "Expandi", "cited": true},
    {"stat": "3-4x", "context": "lower limits", "source": null, "cited": false}
  ],
  "internalLinks": ["/blog/linkedin-account-restricted", "/safety"]
}
```

Be precise and exhaustive. Extract ALL statistics and links found.

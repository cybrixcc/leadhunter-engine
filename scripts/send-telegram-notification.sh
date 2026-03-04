#!/bin/bash

# Unified Telegram Notification Script for LeadHunter
# Sends rich, formatted messages with emojis and progress tracking

set -e

# Colors for local output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT_ID="${TELEGRAM_CHAT_ID:-}"
# Site label shown in notifications — set via SITE_LABEL env var or falls back to SITE_NAME
SITE_LABEL="${SITE_LABEL:-${SITE_NAME:-LeadHunter Blog}}"
SITE_URL="${SITE_URL:-https://lhunter.cc}"

# HTML escape function for Telegram
html_escape() {
  local text="$1"
  text="${text//&/&amp;}"
  text="${text//</&lt;}"
  text="${text//>/&gt;}"
  text="${text//\"/&quot;}"
  echo "$text"
}

# Check if credentials are set
if [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
  echo -e "${YELLOW}⚠️  Telegram credentials not set. Skipping notification.${NC}"
  exit 0
fi

# Parse notification type
NOTIFICATION_TYPE="${1:-}"

if [ -z "$NOTIFICATION_TYPE" ]; then
  echo -e "${RED}Error: Notification type required${NC}"
  echo "Usage: ./send-telegram-notification.sh <type> [args...]"
  echo ""
  echo "Types:"
  echo "  geo-health <score> <prev_score>"
  echo "  geo-research <citation_rate> <gap> <research_dir>"
  echo "  geo-improvements <score_before> <score_after> <pr_url>"
  echo "  geo-complete <citation_rate> <position> <pr_url>"
  echo "  article-generated <title> <topic> <pr_url>"
  echo "  deploy-success <environment> <commit>"
  echo "  gsc-index-check"
  echo "  gsc-keyword-performance"
  echo "  custom <message>"
  exit 1
fi

# ============================================================================
# Notification Templates
# ============================================================================

send_geo_health_notification() {
  local SCORE="${1:-0.0}"
  local ARTICLES="${2:-0}"
  local LOW_LINKS="${3:-0}"
  local NO_QUOTES="${4:-0}"
  local RUN_URL="${5:-https://github.com/${GITHUB_REPOSITORY}/actions}"

  # Determine emoji based on score
  local EMOJI="🟡"
  if (( $(echo "$SCORE >= 9.0" | bc -l 2>/dev/null) )); then
    EMOJI="🟢"
  elif (( $(echo "$SCORE < 7.0" | bc -l 2>/dev/null) )); then
    EMOJI="🔴"
  fi

  # Build issues line
  local ISSUES_LINE=""
  if [ "$LOW_LINKS" -gt 0 ] 2>/dev/null || [ "$NO_QUOTES" -gt 0 ] 2>/dev/null; then
    ISSUES_LINE="
<b>Issues:</b>"
    if [ "$LOW_LINKS" -gt 0 ] 2>/dev/null; then
      ISSUES_LINE="${ISSUES_LINE}
• ${LOW_LINKS} articles need more internal links"
    fi
    if [ "$NO_QUOTES" -gt 0 ] 2>/dev/null; then
      ISSUES_LINE="${ISSUES_LINE}
• ${NO_QUOTES} articles missing quotable blocks"
    fi
  fi

  local MESSAGE=$(cat <<EOF
${EMOJI} <b>GEO Health Check</b>

<b>Score:</b> ${SCORE}/10.0
<b>Articles:</b> ${ARTICLES}
${ISSUES_LINE}

<a href="$(html_escape "${RUN_URL}")">View Full Report →</a>
EOF
)

  send_message "$MESSAGE"
}

send_geo_research_notification() {
  local CITATION_RATE="$1"
  local GAP="$2"
  local RESEARCH_DIR="$3"

  local MESSAGE=$(cat <<EOF
🔍 <b>GEO Research Completed</b>

<b>Citation Rate:</b> ${CITATION_RATE}
<b>Improvement Gap:</b> ${GAP}

<b>Analysis:</b>
• Query discovery ✅
• Multi-AI testing ✅
• Gap analysis ✅
• Recommendations generated ✅

<i>Research data: ${RESEARCH_DIR}</i>
<a href="https://github.com/${GITHUB_REPOSITORY}/issues">View Issues</a>
EOF
)

  send_message "$MESSAGE"
}

send_geo_improvements_notification() {
  local SCORE_BEFORE="$1"
  local SCORE_AFTER="$2"
  local PR_URL="$3"
  local IMPROVEMENT=$(echo "scale=1; $SCORE_AFTER - $SCORE_BEFORE" | bc 2>/dev/null || echo "0.0")

  # Extract PR number from URL
  local PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$' || echo "")

  local MESSAGE=$(cat <<EOF
🤖 <b>GEO Auto-Improvements Applied</b>

<b>Score Improvement:</b>
  Before: ${SCORE_BEFORE}/10.0
  After: ${SCORE_AFTER}/10.0
  <b>Change: +${IMPROVEMENT}</b> 📈

<b>Changes Made:</b>
• Quotable blocks added
• Internal links improved
• Content optimized

<a href="$(html_escape "${PR_URL}")">Review PR #${PR_NUM}</a>
EOF
)

  send_message "$MESSAGE"
}

send_geo_complete_notification() {
  local CITATION_RATE="$1"
  local POSITION="$2"
  local PR_URL="$3"
  local PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$' || echo "")

  local MESSAGE=$(cat <<EOF
✅ <b>GEO Cycle Complete</b>

<b>Results:</b>
📊 Citation Rate: <b>${CITATION_RATE}</b>
🎯 Avg Position: <b>#${POSITION}</b>

<b>Full Cycle Executed:</b>
1. Health check ✅
2. Research phase ✅
3. Improvements applied ✅
4. PR created ✅

<i>Ready for review and merge</i>
<a href="$(html_escape "${PR_URL}")">Review PR #${PR_NUM}</a>
EOF
)

  send_message "$MESSAGE"
}

send_article_generated_notification() {
  local TITLE="$1"
  local TOPIC="$2"
  local PR_URL="$3"
  local PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$' || echo "")

  local MESSAGE=$(cat <<EOF
📝 <b>New Article Generated</b>

<b>#${TOPIC}</b> ${TITLE}

<b>Auto-generated with:</b>
• AI-powered writing ✅
• SEO optimization ✅
• Quality checks passed ✅
• PR created ✅

<a href="$(html_escape "${PR_URL}")">Review PR #${PR_NUM}</a>
EOF
)

  send_message "$MESSAGE"
}

send_deploy_notification() {
  local ENVIRONMENT="$1"
  local COMMIT="$2"
  local SHORT_COMMIT=$(echo "$COMMIT" | cut -c1-7)

  local MESSAGE=$(cat <<EOF
🚀 <b>Deployment Successful</b>

<b>Environment:</b> ${ENVIRONMENT}
<b>Commit:</b> <code>${SHORT_COMMIT}</code>

<i>Site deployed and live</i>
<a href="${SITE_URL}">View Site</a>
EOF
)

  send_message "$MESSAGE"
}

send_custom_notification() {
  local MESSAGE="$1"
  send_message "$MESSAGE"
}

# ============================================================================
# TODO System Notifications
# ============================================================================

send_todo_summary() {
  local RESEARCH_DIR="$1"
  local TASKS_FILE="$RESEARCH_DIR/tasks.json"

  if [ ! -f "$TASKS_FILE" ]; then
    send_message "❌ <b>TODO Plan Error</b>\n\ntasks.json not found in $RESEARCH_DIR"
    return 1
  fi

  local TOTAL_TASKS=$(jq -r '.summary.total_tasks // 0' "$TASKS_FILE")
  local P0_TASKS=$(jq -r '.summary.p0_tasks // 0' "$TASKS_FILE")
  local P1_TASKS=$(jq -r '.summary.p1_tasks // 0' "$TASKS_FILE")
  local P2_TASKS=$(jq -r '.summary.p2_tasks // 0' "$TASKS_FILE")
  local P3_TASKS=$(jq -r '.summary.p3_tasks // 0' "$TASKS_FILE")
  local AUTO_TASKS=$(jq -r '.summary.auto_apply_tasks // 0' "$TASKS_FILE")
  local MANUAL_TASKS=$(jq -r '.summary.manual_tasks // 0' "$TASKS_FILE")
  local ESTIMATED_HOURS=$(jq -r '.summary.estimated_total_time_hours // 0' "$TASKS_FILE")
  local GEO_CURRENT=$(jq -r '.geo_score_current // 0' "$TASKS_FILE")
  local GEO_IMPROVEMENT=$(jq -r '.summary.expected_geo_score_improvement // 0' "$TASKS_FILE")
  local GEO_TARGET=$(echo "scale=1; $GEO_CURRENT + $GEO_IMPROVEMENT" | bc 2>/dev/null || echo "0")
  local CITATION_CURRENT=$(jq -r '.citation_rate_current // 0' "$TASKS_FILE")
  local CITATION_IMPROVEMENT=$(jq -r '.summary.expected_citation_rate_improvement // 0' "$TASKS_FILE")
  local CITATION_TARGET=$(echo "scale=0; ($CITATION_CURRENT + $CITATION_IMPROVEMENT) * 100" | bc 2>/dev/null || echo "0")
  local CITATION_CURRENT_PCT=$(echo "scale=0; $CITATION_CURRENT * 100" | bc 2>/dev/null || echo "0")

  # Get top 3 tasks
  local TOP_TASKS=$(jq -r '.tasks[0:3] | .[] | "• \(.title)\n  Impact: +\(.expected_outcome.geo_score_delta // 0) score, \(.estimated_time_minutes // 0) min"' "$TASKS_FILE")

  local MESSAGE=$(cat <<EOF
📋 <b>TODO Plan Generated</b>

<b>📊 Summary</b>
Total: ${TOTAL_TASKS} tasks | P0: ${P0_TASKS} | P1: ${P1_TASKS}

<b>🎯 Impact</b>
Citation: ${CITATION_CURRENT_PCT}% → ${CITATION_TARGET}% (+$(echo "scale=0; $CITATION_IMPROVEMENT * 100" | bc)%)
Timeline: ~${ESTIMATED_HOURS}h

<b>🔥 Top 3 Tasks</b>
${TOP_TASKS}

<a href="https://github.com/${GITHUB_REPOSITORY}/issues">View Full Plan</a>
EOF
)

  send_message "$MESSAGE"
}

send_content_plan_update() {
  local RESEARCH_DIR="$1"
  local CHANGELOG="$RESEARCH_DIR/CONTENT_PLAN_UPDATES.md"

  if [ ! -f "$CHANGELOG" ]; then
    send_message "❌ <b>Content Plan Update Error</b>\n\nCONTENT_PLAN_UPDATES.md not found"
    return 1
  fi

  # Extract summary from changelog
  local NEW_ARTICLES=$(grep -c "^### Article #" "$CHANGELOG" 2>/dev/null || echo "0")
  local REPRIORITIZED=$(grep -c "Priority increased" "$CHANGELOG" 2>/dev/null || echo "0")

  local MESSAGE=$(cat <<EOF
📝 <b>Content Plan Updated</b>

<b>New articles:</b> ${NEW_ARTICLES} (from GEO gaps)
<b>Re-prioritized:</b> ${REPRIORITIZED}

<a href="https://github.com/${GITHUB_REPOSITORY}/blob/master/${RESEARCH_DIR}/CONTENT_PLAN_UPDATES.md">View Changelog</a>
EOF
)

  send_message "$MESSAGE"
}

send_tasks_applied() {
  local TASKS_APPLIED="$1"
  local TASKS_TOTAL="$2"
  local PR_URL="$3"
  local PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$' || echo "")

  local MESSAGE=$(cat <<EOF
🤖 <b>Auto-Tasks Applied</b>

<b>Applied:</b> ${TASKS_APPLIED}/${TASKS_TOTAL} tasks
<b>Status:</b> Ready for review

<b>Changes:</b>
• Quotable blocks added
• Internal links improved
• Meta descriptions updated

<a href="$(html_escape "${PR_URL}")">Review PR #${PR_NUM}</a>
EOF
)

  send_message "$MESSAGE"
}

# ============================================================================
# Progress Tracking Notifications
# ============================================================================

send_progress_start() {
  local PROCESS_NAME="$1"
  local TOTAL_STEPS="${2:-5}"

  local MESSAGE=$(cat <<EOF
⏳ <b>${PROCESS_NAME} Started</b>

<b>Progress:</b> 0/${TOTAL_STEPS} steps

<i>Process initiated...</i>
EOF
)

  send_message "$MESSAGE"
}

send_progress_update() {
  local PROCESS_NAME="$1"
  local CURRENT_STEP="$2"
  local TOTAL_STEPS="$3"
  local STEP_NAME="$4"

  # Calculate progress bar
  local COMPLETED=$((CURRENT_STEP * 10 / TOTAL_STEPS))
  local REMAINING=$((10 - COMPLETED))
  local PROGRESS_BAR="$(printf '█%.0s' $(seq 1 $COMPLETED))$(printf '░%.0s' $(seq 1 $REMAINING))"

  local MESSAGE=$(cat <<EOF
⏳ <b>${PROCESS_NAME}</b>

<b>Progress:</b> ${CURRENT_STEP}/${TOTAL_STEPS}
${PROGRESS_BAR}

<i>Current: ${STEP_NAME}</i>
EOF
)

  send_message "$MESSAGE"
}

send_progress_complete() {
  local PROCESS_NAME="$1"
  local DURATION="${2:-unknown}"
  local RESULT_URL="${3:-}"

  local LINK_LINE=""
  if [ -n "$RESULT_URL" ]; then
    LINK_LINE="<a href=\"$(html_escape "${RESULT_URL}")\">View Results</a>"
  fi

  local MESSAGE=$(cat <<EOF
✅ <b>${PROCESS_NAME} Complete</b>

<b>Duration:</b> ${DURATION}
<b>Status:</b> Success ✅

${LINK_LINE}
EOF
)

  send_message "$MESSAGE"
}

# ============================================================================
# Rich Detailed Notifications
# ============================================================================

send_geo_research_detailed() {
  local RESEARCH_DIR="$1"

  # Extract data from JSON files
  local CITATION_RATE=$(jq -r '.citation_rate // "N/A"' "$RESEARCH_DIR/ai-test-results.json" 2>/dev/null || echo "N/A")
  local AVG_POSITION=$(jq -r '.avg_position // "N/A"' "$RESEARCH_DIR/ai-test-results.json" 2>/dev/null || echo "N/A")
  local QUERIES_TESTED=$(jq -r '.queries_tested // "N/A"' "$RESEARCH_DIR/ai-test-results.json" 2>/dev/null || echo "N/A")
  local GAPS_COUNT=$(jq -r '.gaps_identified | length' "$RESEARCH_DIR/ai-test-results.json" 2>/dev/null || echo "0")
  local RECS_COUNT=$(jq -r '.total_recommendations // "N/A"' "$RESEARCH_DIR/recommendations.json" 2>/dev/null || echo "N/A")

  local MESSAGE=$(cat <<EOF
🔬 <b>GEO Research - Detailed Report</b>

<b>📊 AI Citation Testing:</b>
• Queries tested: ${QUERIES_TESTED}
• Citation rate: <b>${CITATION_RATE}</b>
• Avg position: <b>#${AVG_POSITION}</b>
• AI systems: ChatGPT, Claude, Perplexity, Gemini

<b>🔍 Gap Analysis:</b>
• Gaps identified: ${GAPS_COUNT}
• Recommendations: ${RECS_COUNT}

<b>🎯 Top Findings:</b>
$(jq -r '.gaps_identified[0:3][] | "• " + .query + " (" + .issue + ")"' "$RESEARCH_DIR/ai-test-results.json" 2>/dev/null || echo "• No gaps data available")

<i>Research directory: ${RESEARCH_DIR}</i>
<a href="https://github.com/${GITHUB_REPOSITORY}/issues">View Full Report</a>
EOF
)

  send_message "$MESSAGE"
}

send_geo_started() {
  local MODE="$1"

  local MODE_DESC="Research only"
  if [ "$MODE" = "research-and-plan" ]; then
    MODE_DESC="Research &amp; TODO plan"
  elif [ "$MODE" = "full-auto" ]; then
    MODE_DESC="Full automation"
  fi

  local MESSAGE=$(cat <<EOF
🚀 <b>GEO Research Started</b>

<b>Mode:</b> ${MODE_DESC}

Running health check, AI testing, gap analysis...
EOF
)

  send_message "$MESSAGE"
}

send_geo_final_report() {
  local MODE="$1"
  local CITATION_RATE="$2"
  local ISSUE_URL="$3"
  local P0_TASKS="$4"

  local MESSAGE=$(cat <<EOF
✅ <b>GEO Research Complete</b>

<b>Mode:</b> ${MODE}
<b>Citation Rate:</b> ${CITATION_RATE}%
<b>Critical Tasks:</b> ${P0_TASKS}

<a href="$(html_escape "${ISSUE_URL}")">View TODO Issue →</a>
EOF
)

  send_message "$MESSAGE"
}

send_citation_research() {
  local LINK_URL="${1:-}"
  local RESULTS_FILE="/tmp/citation-research-results.json"

  if [ ! -f "$RESULTS_FILE" ]; then
    send_message "🔴 <b>AI Citation Research</b>

❌ Results file not found
<a href=\"$(html_escape "${LINK_URL}")\">View Run →</a>"
    return 1
  fi

  # Summary numbers
  local RATE_PCT
  RATE_PCT=$(jq -r '.summary.citationRatePercent // "0.0%"' "$RESULTS_FILE")
  local RATE_NUM
  RATE_NUM=$(jq -r '(.summary.citationRate // 0) * 100 | floor' "$RESULTS_FILE")
  local TOTAL_QUERIES
  TOTAL_QUERIES=$(jq -r '.metadata.totalQueries // 0' "$RESULTS_FILE")
  local DURATION
  DURATION=$(jq -r '
    .metadata.durationSeconds as $s |
    if $s >= 60 then (($s / 60 | floor | tostring) + "m " + ($s % 60 | tostring) + "s")
    else ($s | tostring) + "s" end
  ' "$RESULTS_FILE")
  local MODELS
  MODELS=$(jq -r '.metadata.models // [] | join(", ")' "$RESULTS_FILE")

  local RATE_EMOJI="🔴"
  if [ "$RATE_NUM" -gt 30 ] 2>/dev/null; then RATE_EMOJI="🟢"
  elif [ "$RATE_NUM" -gt 10 ] 2>/dev/null; then RATE_EMOJI="🟡"
  fi

  # Per-AI breakdown  e.g. "Claude 0% · Gemini 0% · ChatGPT —"
  local PER_AI
  PER_AI=$(jq -r '
    .summary.perAI // [] |
    map(
      .name + " " +
      (if .queriesAnswered > 0
       then ((.citationRate * 100 | floor | tostring) + "%")
       else "—"
       end)
    ) | join(" · ")
  ' "$RESULTS_FILE")

  # Top 3 competitors by mentions
  local TOP_COMPETITORS
  TOP_COMPETITORS=$(jq -r '
    .summary.competitorRanking // [] |
    sort_by(-.mentions) |
    .[0:3] |
    to_entries |
    map(
      (if .key == 0 then "🥇" elif .key == 1 then "🥈" else "🥉" end) +
      " " + .value.competitor + " (" + (.value.mentions | tostring) + ")"
    ) | join("\n")
  ' "$RESULTS_FILE")

  # Category breakdown — only show non-zero or all if all zero
  local CAT_LINES
  CAT_LINES=$(jq -r '
    .summary.perCategory // [] |
    map("• " + .label + ": " + (.citationRate * 100 | floor | tostring) + "% (" + (.citationCount | tostring) + "/" + (.queryCount | tostring) + ")")
    | join("\n")
  ' "$RESULTS_FILE")

  # Top uncited query (first miss)
  local FIRST_MISS
  FIRST_MISS=$(jq -r '
    [.results // [] | .[] | select(.leadhunterCited == false)] |
    .[0].query // ""
  ' "$RESULTS_FILE")

  local FIRST_MISS_COMPETITORS
  FIRST_MISS_COMPETITORS=$(jq -r '
    [.results // [] | .[] | select(.leadhunterCited == false)] |
    .[0].competitorsMentioned // [] | .[0:3] | join(", ")
  ' "$RESULTS_FILE")

  # Recommendations count
  local RECS
  RECS=$(jq -r '.gap_analysis.recommendations // [] | length' "$RESULTS_FILE")

  local MISS_BLOCK=""
  if [ -n "$FIRST_MISS" ]; then
    MISS_BLOCK="
<b>Example miss:</b>
❌ \"${FIRST_MISS}\"
   → cited: ${FIRST_MISS_COMPETITORS:-none}"
  fi

  local MESSAGE
  MESSAGE=$(cat <<EOF
${RATE_EMOJI} <b>AI Citation Research</b>

<b>Citation rate: ${RATE_PCT}</b> (0/${TOTAL_QUERIES} queries · ${DURATION})
<i>% of queries where LeadHunter was mentioned by the AI</i>

<b>By model:</b> ${PER_AI}

<b>By category:</b>
${CAT_LINES}

<b>Competitors dominating:</b>
${TOP_COMPETITORS}
${MISS_BLOCK}
<b>${RECS} content recommendations</b> in the full report
<a href="$(html_escape "${LINK_URL}")">Read full report →</a>
EOF
)

  send_message "$MESSAGE"
}

send_todo_issue_created() {
  local P0_TASKS="$1"
  local ISSUE_NUMBER="$2"
  local ISSUE_URL="$3"

  local MESSAGE=$(cat <<EOF
🎯 <b>TODO Issue #${ISSUE_NUMBER} Created</b>

${P0_TASKS} critical tasks identified

<a href="$(html_escape "${ISSUE_URL}")">View Issue →</a>
EOF
)

  send_message "$MESSAGE"
}

# ============================================================================
# GSC Index Check Notification
# ============================================================================

send_gsc_index_check_notification() {
  local RESULTS_FILE="/tmp/gsc-index-results.json"
  local RUN_URL="${GITHUB_RUN_URL:-}"

  if [ ! -f "$RESULTS_FILE" ]; then
    local LINK=""
    if [ -n "$RUN_URL" ]; then
      LINK="

<a href=\"$(html_escape "${RUN_URL}")\">View Logs →</a>"
    fi
    send_message "🔍 <b>GSC Index Check</b>

❌ Failed: results file not found${LINK}"
    return 1
  fi

  local ERROR=$(jq -r '.error // empty' "$RESULTS_FILE")

  if [ -n "$ERROR" ]; then
    local LINK=""
    if [ -n "$RUN_URL" ]; then
      LINK="

<a href=\"$(html_escape "${RUN_URL}")\">View Logs →</a>"
    fi
    send_message "🔍 <b>GSC Index Check</b>

❌ Failed: $(html_escape "$ERROR")${LINK}"
    return 0
  fi

  local TOTAL=$(jq -r '.total' "$RESULTS_FILE")
  local INDEXED=$(jq -r '.indexed' "$RESULTS_FILE")
  local SUBMITTED=$(jq -r '.submitted' "$RESULTS_FILE")
  local STALE=$(jq -r '.staleResubmitted' "$RESULTS_FILE")
  local NOT_INDEXED=$(jq -r '.notIndexed' "$RESULTS_FILE")
  local ERRORS=$(jq -r '.errors' "$RESULTS_FILE")

  # Build link line
  local LINK_LINE=""
  if [ -n "$RUN_URL" ]; then
    LINK_LINE="
<a href=\"$(html_escape "${RUN_URL}")\">View Logs →</a>"
  fi

  # Index rate for context line
  local INDEX_RATE=0
  if [ "$TOTAL" -gt 0 ]; then
    INDEX_RATE=$(( INDEXED * 100 / TOTAL ))
  fi

  # Helper: build a collapsed list — show first N items, then "+ X more"
  # Usage: collapsed_list <json_array_key> <max_shown>
  collapsed_list() {
    local KEY="$1"
    local MAX="$2"
    local ALL
    ALL=$(jq -r ".${KEY}[]" "$RESULTS_FILE" 2>/dev/null)
    local COUNT
    COUNT=$(echo "$ALL" | grep -c . 2>/dev/null || echo 0)
    if [ "$COUNT" -eq 0 ]; then
      echo ""
      return
    fi
    local SHOWN
    SHOWN=$(echo "$ALL" | head -n "$MAX" | sed 's/^/• /')
    local REST=$(( COUNT - MAX ))
    if [ "$REST" -gt 0 ]; then
      echo "${SHOWN}
  <i>+ ${REST} more (see logs)</i>"
    else
      echo "$SHOWN"
    fi
  }

  if [ "$SUBMITTED" -eq 0 ] && [ "$STALE" -eq 0 ] && [ "$NOT_INDEXED" -eq 0 ] && [ "$ERRORS" -eq 0 ]; then
    # All pages indexed and fresh
    local MESSAGE=$(cat <<EOF
🔍 <b>GSC Index Check</b>

✅ All ${TOTAL} pages indexed — nothing to do${LINK_LINE}
EOF
)
  else
    # Build detail blocks with collapsed lists
    local DETAILS=""

    if [ "$SUBMITTED" -gt 0 ]; then
      local NEW_LIST
      NEW_LIST=$(collapsed_list "submittedPages" 8)
      DETAILS="${DETAILS}
<b>⏳ Submitted for indexing (${SUBMITTED}):</b>
${NEW_LIST}"
    fi

    if [ "$STALE" -gt 0 ]; then
      local STALE_LIST
      STALE_LIST=$(collapsed_list "stalePages" 5)
      DETAILS="${DETAILS}
<b>🔄 Resubmitted — content updated (${STALE}):</b>
${STALE_LIST}"
    fi

    if [ "$NOT_INDEXED" -gt 0 ]; then
      local NI_LIST
      NI_LIST=$(collapsed_list "notIndexedPages" 5)
      DETAILS="${DETAILS}
<b>⚠️ Still waiting for Google (${NOT_INDEXED}):</b>
${NI_LIST}
<i>Previously submitted — Google hasn't crawled yet. Normal for new sites, takes days–weeks.</i>"
    fi

    local ERRORS_LINE=""
    if [ "$ERRORS" -gt 0 ]; then
      ERRORS_LINE="
❌ <b>API errors: ${ERRORS}</b> — check logs"
    fi

    local MESSAGE=$(cat <<EOF
🔍 <b>GSC Index Check</b>

📊 ${INDEXED}/${TOTAL} pages indexed (${INDEX_RATE}%)
<i>Indexed = Google added to search results. Low % is normal for new sites — takes months to build authority.</i>${ERRORS_LINE}
${DETAILS}${LINK_LINE}
EOF
)
  fi

  send_message "$MESSAGE"
}

# ============================================================================
# GSC Keyword Performance Notification
# ============================================================================

send_gsc_keyword_performance_notification() {
  local RESULTS_FILE="/tmp/gsc-keyword-results.json"
  local RUN_URL="${GITHUB_RUN_URL:-}"
  local ISSUE_URL="${GSC_ISSUE_URL:-}"

  if [ ! -f "$RESULTS_FILE" ]; then
    local LINK=""
    if [ -n "$RUN_URL" ]; then
      LINK="

<a href=\"$(html_escape "${RUN_URL}")\">View Logs →</a>"
    fi
    send_message "📊 <b>GSC Keyword Performance</b>

❌ Failed: results file not found${LINK}"
    return 1
  fi

  local ERROR=$(jq -r '.error // empty' "$RESULTS_FILE")

  if [ -n "$ERROR" ]; then
    local LINK=""
    if [ -n "$RUN_URL" ]; then
      LINK="

<a href=\"$(html_escape "${RUN_URL}")\">View Logs →</a>"
    fi
    send_message "📊 <b>GSC Keyword Performance</b>

❌ Failed: $(html_escape "$ERROR")${LINK}"
    return 0
  fi

  local TOTAL_KEYWORDS=$(jq -r '.summary.totalKeywords' "$RESULTS_FILE")
  local TOTAL_CLICKS=$(jq -r '.summary.totalClicks' "$RESULTS_FILE")
  local CLICKS_DELTA=$(jq -r '.summary.clicksDelta' "$RESULTS_FILE")
  local TOTAL_IMPRESSIONS=$(jq -r '.summary.totalImpressions' "$RESULTS_FILE")
  local IMPRESSIONS_DELTA=$(jq -r '.summary.impressionsDelta' "$RESULTS_FILE")
  local AVG_POSITION=$(jq -r '.summary.avgPosition' "$RESULTS_FILE")
  local AVG_CTR=$(jq -r '.summary.avgCtr' "$RESULTS_FILE")
  local RISING=$(jq -r '.rising | length' "$RESULTS_FILE")
  local DECLINING=$(jq -r '.declining | length' "$RESULTS_FILE")
  local STRIKE=$(jq -r '.strikeDistance | length' "$RESULTS_FILE")
  local ACTION_ITEMS=$(jq -r '.actionItems | length' "$RESULTS_FILE")

  # Top keyword
  local TOP_KEYWORD=$(jq -r '.topByClicks[0].query // "none"' "$RESULTS_FILE")
  local TOP_POSITION=$(jq -r '.topByClicks[0].position // 0' "$RESULTS_FILE")
  local TOP_CLICKS=$(jq -r '.topByClicks[0].clicks // 0' "$RESULTS_FILE")

  local TOP_LINE=""
  if [ "$TOP_KEYWORD" != "none" ] && [ "$TOP_KEYWORD" != "null" ]; then
    TOP_LINE="
🔥 Top: $(html_escape "$TOP_KEYWORD") (pos ${TOP_POSITION}, ${TOP_CLICKS} clicks)"
  fi

  # Build links
  local LINK_LINE=""
  if [ -n "$ISSUE_URL" ] && [ -n "$RUN_URL" ]; then
    LINK_LINE="
<a href=\"$(html_escape "${ISSUE_URL}")\">Action Plan</a> · <a href=\"$(html_escape "${RUN_URL}")\">Logs</a>"
  elif [ -n "$ISSUE_URL" ]; then
    LINK_LINE="
<a href=\"$(html_escape "${ISSUE_URL}")\">View Action Plan →</a>"
  elif [ -n "$RUN_URL" ]; then
    LINK_LINE="
<a href=\"$(html_escape "${RUN_URL}")\">View Logs →</a>"
  fi

  local MESSAGE=$(cat <<EOF
📊 <b>GSC Keyword Performance</b>

📈 Clicks: ${TOTAL_CLICKS} (${CLICKS_DELTA})
👁 Impressions: ${TOTAL_IMPRESSIONS} (${IMPRESSIONS_DELTA})
🎯 Avg Position: ${AVG_POSITION}
📊 Keywords: ${TOTAL_KEYWORDS}
${TOP_LINE}
📈 Rising: ${RISING} keywords
📉 Declining: ${DECLINING} keywords
🎯 Strike distance: ${STRIKE} keywords
📋 Action items: ${ACTION_ITEMS}${LINK_LINE}
EOF
)

  send_message "$MESSAGE"
}

# ============================================================================
# Core send function
# ============================================================================

send_message() {
  local MESSAGE="$1"
  local PARSE_MODE="${2:-HTML}"

  # Send to Telegram
  local RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d chat_id="${CHAT_ID}" \
    -d text="$MESSAGE" \
    -d parse_mode="${PARSE_MODE}" \
    -d disable_web_page_preview="true")

  # Check if successful
  if echo "$RESPONSE" | grep -q '"ok":true'; then
    echo -e "${GREEN}✅ Telegram notification sent${NC}"
  else
    echo -e "${RED}❌ Failed to send Telegram notification${NC}"
    echo "$RESPONSE" | jq -r '.description // "Unknown error"' 2>/dev/null || echo "$RESPONSE"
  fi
}

# ============================================================================
# Main execution
# ============================================================================

case "$NOTIFICATION_TYPE" in
  "geo-health")
    send_geo_health_notification "$2" "$3" "$4" "$5" "$6"
    ;;
  "geo-research")
    send_geo_research_notification "$2" "$3" "$4"
    ;;
  "geo-improvements")
    send_geo_improvements_notification "$2" "$3" "$4"
    ;;
  "geo-complete")
    send_geo_complete_notification "$2" "$3" "$4"
    ;;
  "geo-research-detailed")
    send_geo_research_detailed "$2"
    ;;
  "article-generated")
    send_article_generated_notification "$2" "$3" "$4"
    ;;
  "deploy")
    send_deploy_notification "$2" "$3"
    ;;
  "progress-start")
    send_progress_start "$2" "$3"
    ;;
  "progress-update")
    send_progress_update "$2" "$3" "$4" "$5"
    ;;
  "progress-complete")
    send_progress_complete "$2" "$3" "$4"
    ;;
  "custom")
    send_custom_notification "$2"
    ;;
  "todo-summary")
    send_todo_summary "$2"
    ;;
  "content-plan-update")
    send_content_plan_update "$2"
    ;;
  "tasks-applied")
    send_tasks_applied "$2" "$3" "$4"
    ;;
  "todo-issue-created")
    send_todo_issue_created "$2" "$3" "$4"
    ;;
  "citation-research")
    send_citation_research "$2" "$3" "$4" "$5" "$6"
    ;;
  "geo-started")
    send_geo_started "$2"
    ;;
  "geo-final-report")
    send_geo_final_report "$2" "$3" "$4" "$5"
    ;;
  "gsc-index-check")
    send_gsc_index_check_notification
    ;;
  "gsc-keyword-performance")
    send_gsc_keyword_performance_notification
    ;;
  *)
    echo -e "${RED}Error: Unknown notification type: $NOTIFICATION_TYPE${NC}"
    exit 1
    ;;
esac

exit 0

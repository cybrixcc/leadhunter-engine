#!/bin/bash

# GEO Health Check Script for LeadHunter
# Monitors AI optimization health across all content
# Run weekly: ./scripts/geo-health-check.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configurable via env vars (populated by the reusable workflow from config.yml)
SITE_LABEL="${SITE_LABEL:-${SITE_NAME:-LeadHunter}}"
# Path pattern for blog articles (relative to repo root)
BLOG_GLOB="${BLOG_GLOB:-src/app/blog/*/page.tsx}"

echo -e "${BLUE}🔍 ${SITE_LABEL} GEO Health Check${NC}"
echo "============================================"
echo "Date: $(date)"
echo ""

# Create logs directory if it doesn't exist
mkdir -p logs

# Initialize counters
total_articles=0
missing_tldr=0
missing_faq=0
outdated=0
missing_quotes=0
low_links=0
total_links=0

# Arrays to store problematic articles
declare -a articles_no_tldr
declare -a articles_no_faq
declare -a articles_outdated
declare -a articles_no_quotes
declare -a articles_low_links

# 1. Internal Linking Analysis
echo -e "${BLUE}📊 Internal Linking Analysis:${NC}"
echo "Target: 5-7 internal links per article"
echo ""

for file in $BLOG_GLOB; do
  if [ -f "$file" ]; then
    article=$(basename "$(dirname "$file")")
    ((total_articles++)) || true

    # Count internal blog links
    link_count=$(grep -c 'href="/blog/' "$file" || true)

    # Count other internal links (non-blog)
    other_links=$(grep -o 'href="/[^"]*"' "$file" | grep -v '/blog/' | grep -v 'https://' | grep -v 'href="/#' | wc -l | tr -d ' ') || other_links=0
    total_link_count=$((link_count + other_links))

    ((total_links += total_link_count)) || true

    if [ "$total_link_count" -lt 4 ]; then
      echo -e "  ${RED}⚠️  $article: $total_link_count links${NC} (needs more)"
      ((low_links++)) || true
      articles_low_links+=("$article ($total_link_count links)")
    else
      echo -e "  ${GREEN}✅ $article: $total_link_count links${NC}"
    fi
  fi
done

# Guard: exit early if no articles found
if [ "$total_articles" -eq 0 ]; then
  echo -e "${RED}No blog articles found. Exiting.${NC}"
  exit 1
fi

avg_links=$(awk "BEGIN {printf \"%.1f\", $total_links / $total_articles}")
echo ""
echo -e "${BLUE}Average links per article: $avg_links${NC}"
echo ""

# 2. TL;DR Coverage
echo -e "${BLUE}📋 TL;DR Coverage:${NC}"
echo "Checking for TL;DR sections (critical for AI extraction)"
echo ""

for file in $BLOG_GLOB; do
  if [ -f "$file" ]; then
    article=$(basename "$(dirname "$file")")

    if ! grep -q "TL;DR\|Quick Answer\|Key Takeaways" "$file"; then
      echo -e "  ${RED}❌ Missing TL;DR: $article${NC}"
      ((missing_tldr++)) || true
      articles_no_tldr+=("$article")
    fi
  fi
done

if [ "$missing_tldr" -eq 0 ]; then
  echo -e "  ${GREEN}✅ All articles have TL;DR sections${NC}"
else
  echo -e "  ${RED}Total missing: $missing_tldr${NC}"
fi
echo ""

# 3. FAQ Schema Coverage
echo -e "${BLUE}❓ FAQ Schema Coverage:${NC}"
echo "Checking for FAQJsonLd (Google rich snippets)"
echo ""

for file in $BLOG_GLOB; do
  if [ -f "$file" ]; then
    article=$(basename "$(dirname "$file")")

    if ! grep -q "FAQJsonLd" "$file"; then
      echo -e "  ${RED}❌ Missing FAQJsonLd: $article${NC}"
      ((missing_faq++)) || true
      articles_no_faq+=("$article")
    fi
  fi
done

if [ "$missing_faq" -eq 0 ]; then
  echo -e "  ${GREEN}✅ All articles have FAQ schema${NC}"
else
  echo -e "  ${RED}Total missing: $missing_faq${NC}"
fi
echo ""

# 4. Freshness Signals (2025/2026 year references)
echo -e "${BLUE}🗓️  Freshness Signals:${NC}"
echo "Checking for current year references (2025/2026)"
echo ""

for file in $BLOG_GLOB; do
  if [ -f "$file" ]; then
    article=$(basename "$(dirname "$file")")

    if ! grep -q "202[56]" "$file"; then
      echo -e "  ${YELLOW}⚠️  No year reference: $article${NC}"
      ((outdated++)) || true
      articles_outdated+=("$article")
    fi
  fi
done

if [ "$outdated" -eq 0 ]; then
  echo -e "  ${GREEN}✅ All articles have current year references${NC}"
else
  echo -e "  ${YELLOW}Total without year: $outdated${NC}"
fi
echo ""

# 5. Quotable Blocks
echo -e "${BLUE}💬 Quotable Snippets:${NC}"
echo "Checking for <blockquote> elements (AI-friendly citations)"
echo ""

for file in $BLOG_GLOB; do
  if [ -f "$file" ]; then
    article=$(basename "$(dirname "$file")")

    if ! grep -q "<blockquote" "$file"; then
      echo -e "  ${YELLOW}⚠️  No quotable blocks: $article${NC}"
      ((missing_quotes++)) || true
      articles_no_quotes+=("$article")
    fi
  fi
done

if [ "$missing_quotes" -eq 0 ]; then
  echo -e "  ${GREEN}✅ All articles have quotable blocks${NC}"
else
  echo -e "  ${YELLOW}Total without quotes: $missing_quotes${NC}"
fi
echo ""

# 6. Calculate Overall GEO Health Score
echo -e "${BLUE}🎯 Overall GEO Health Score:${NC}"
echo "============================================"
echo ""

# Scoring rubric (out of 10)
# - Internal linking: 2.5 points (avg 5+ links = full, 3-4 = 1.5, <3 = 0)
# - TL;DR coverage: 2.5 points (100% = full, partial = proportional)
# - FAQ schema: 2.0 points (100% = full, partial = proportional)
# - Freshness: 1.5 points (100% = full, partial = proportional)
# - Quotable blocks: 1.5 points (100% = full, partial = proportional)

# Internal linking score
link_score=$(awk "BEGIN {if ($avg_links >= 5) print 2.5; else if ($avg_links >= 3) print 1.5; else print 0.5}")

# Component scores using awk (avoids bc leading-dot issues)
tldr_score=$(awk "BEGIN {printf \"%.2f\", ($total_articles - $missing_tldr) / $total_articles * 2.5}")
faq_score=$(awk "BEGIN {printf \"%.2f\", ($total_articles - $missing_faq) / $total_articles * 2.0}")
fresh_score=$(awk "BEGIN {printf \"%.2f\", ($total_articles - $outdated) / $total_articles * 1.5}")
quote_score=$(awk "BEGIN {printf \"%.2f\", ($total_articles - $missing_quotes) / $total_articles * 1.5}")

# Total score
total_score=$(awk "BEGIN {printf \"%.1f\", $link_score + $tldr_score + $faq_score + $fresh_score + $quote_score}")

echo "Total Articles Analyzed: $total_articles"
echo ""
echo "Component Scores:"
echo "  Internal Linking: $link_score / 2.5 (avg $avg_links links/article)"
echo "  TL;DR Coverage:   $tldr_score / 2.5 ($missing_tldr missing)"
echo "  FAQ Schema:       $faq_score / 2.0 ($missing_faq missing)"
echo "  Freshness:        $fresh_score / 1.5 ($outdated outdated)"
echo "  Quotable Blocks:  $quote_score / 1.5 ($missing_quotes missing)"
echo ""

# Color code total score
score_color=$RED
if (( $(awk "BEGIN {print ($total_score >= 9.0)}") )); then
  score_color=$GREEN
elif (( $(awk "BEGIN {print ($total_score >= 7.0)}") )); then
  score_color=$YELLOW
fi

echo -e "${score_color}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${score_color}TOTAL GEO HEALTH SCORE: $total_score / 10.0${NC}"
echo -e "${score_color}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 7. Priority Action Items
echo -e "${BLUE}📝 Priority Action Items:${NC}"
echo "============================================"
echo ""

# Critical issues (score < 7.0)
if (( $(awk "BEGIN {print ($total_score < 7.0)}") )); then
  echo -e "${RED}🔴 CRITICAL: GEO health below target (7.0+)${NC}"
  echo ""
fi

# Internal linking (highest priority)
if [ "$low_links" -gt 0 ]; then
  echo -e "${RED}1. Add Internal Links (Priority: CRITICAL)${NC}"
  echo "   Articles need more links:"
  for article_info in "${articles_low_links[@]}"; do
    echo "   - $article_info"
  done
  echo ""
fi

# TL;DR missing
if [ "$missing_tldr" -gt 0 ]; then
  echo -e "${RED}2. Add TL;DR Sections (Priority: HIGH)${NC}"
  echo "   Articles missing TL;DR:"
  for article in "${articles_no_tldr[@]}"; do
    echo "   - $article"
  done
  echo ""
fi

# FAQ missing
if [ "$missing_faq" -gt 0 ]; then
  echo -e "${YELLOW}3. Add FAQ Schema (Priority: MEDIUM)${NC}"
  echo "   Articles missing FAQJsonLd:"
  for article in "${articles_no_faq[@]}"; do
    echo "   - $article"
  done
  echo ""
fi

# Quotable blocks
if [ "$missing_quotes" -gt 5 ]; then
  echo -e "${YELLOW}4. Add Quotable Blocks (Priority: MEDIUM)${NC}"
  echo "   $missing_quotes articles missing quotable snippets"
  echo "   Top 5 to fix:"
  for i in {0..4}; do
    if [ $i -lt ${#articles_no_quotes[@]} ]; then
      echo "   - ${articles_no_quotes[$i]}"
    fi
  done
  echo ""
fi

# 8. Save Report
REPORT_FILE="logs/geo-health-$(date +%Y%m%d-%H%M%S).txt"
{
  echo "${SITE_LABEL} GEO Health Report"
  echo "Generated: $(date)"
  echo ""
  echo "=== SUMMARY ==="
  echo "Total Articles: $total_articles"
  echo "GEO Health Score: $total_score / 10.0"
  echo ""
  echo "=== COMPONENT SCORES ==="
  echo "Internal Linking: $link_score / 2.5 (avg $avg_links links/article)"
  echo "TL;DR Coverage:   $tldr_score / 2.5 ($missing_tldr missing)"
  echo "FAQ Schema:       $faq_score / 2.0 ($missing_faq missing)"
  echo "Freshness:        $fresh_score / 1.5 ($outdated outdated)"
  echo "Quotable Blocks:  $quote_score / 1.5 ($missing_quotes missing)"
  echo ""
  echo "=== ISSUES FOUND ==="
  echo "Low Internal Links: $low_links articles"
  echo "Missing TL;DR: $missing_tldr articles"
  echo "Missing FAQ: $missing_faq articles"
  echo "Outdated: $outdated articles"
  echo "No Quotes: $missing_quotes articles"
  echo ""
  echo "=== ARTICLES NEEDING ATTENTION ==="
  if [ "$low_links" -gt 0 ]; then
    echo ""
    echo "Low Internal Links:"
    for article_info in "${articles_low_links[@]}"; do
      echo "  - $article_info"
    done
  fi
  if [ "$missing_tldr" -gt 0 ]; then
    echo ""
    echo "Missing TL;DR:"
    for article in "${articles_no_tldr[@]}"; do
      echo "  - $article"
    done
  fi
  if [ "$missing_faq" -gt 0 ]; then
    echo ""
    echo "Missing FAQ Schema:"
    for article in "${articles_no_faq[@]}"; do
      echo "  - $article"
    done
  fi
} > "$REPORT_FILE"

echo -e "${GREEN}📄 Full report saved to: $REPORT_FILE${NC}"
echo ""

echo -e "${GREEN}✅ GEO Health Check Complete${NC}"
echo ""

# Exit with status code based on score
if (( $(awk "BEGIN {print ($total_score >= 7.0)}") )); then
  exit 0  # Good or better
else
  exit 1  # Needs improvement
fi

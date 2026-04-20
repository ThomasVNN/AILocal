#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../smoke_stack.sh"

assert_eq() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "ASSERT_EQ failed: $message" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    exit 1
  fi
}

test_prefers_available_models_in_priority_order() {
  local payload='{"data":[{"id":"gemini-web2api/gemini-2.5-pro"},{"id":"chatgpt-web2api/gpt-5.1"},{"id":"claude/claude-sonnet-4-6"}]}'
  local models=()
  while IFS= read -r model || [[ -n "$model" ]]; do
    if [[ -n "$model" ]]; then
      models+=("$model")
    fi
  done < <(resolve_smoke_models "$payload")

  assert_eq "chatgpt-web2api/gpt-5.1" "${models[0]:-}" "preferred models should come first"
  assert_eq "gemini-web2api/gemini-2.5-pro" "${models[1]:-}" "remaining preferred models should follow"
  assert_eq "claude/claude-sonnet-4-6" "${models[2]:-}" "other available preferred providers should be retained"
}

test_falls_back_to_supported_provider_models_when_preferred_ids_missing() {
  local payload='{"data":[{"id":"gemini-web2api/gemini-2.5-flash-lite"},{"id":"claude/claude-3-7-sonnet"},{"id":"local/qwen"}]}'
  local models=()
  while IFS= read -r model || [[ -n "$model" ]]; do
    if [[ -n "$model" ]]; then
      models+=("$model")
    fi
  done < <(resolve_smoke_models "$payload")

  assert_eq "gemini-web2api/gemini-2.5-flash-lite" "${models[0]:-}" "supported provider models should be selected"
  assert_eq "claude/claude-3-7-sonnet" "${models[1]:-}" "multiple supported provider models should be preserved"
  assert_eq "2" "${#models[@]}" "unsupported local models should be excluded from central smoke candidates"
}

test_classifies_retryable_rate_limit_errors() {
  local response='{"error":{"message":"[chatgpt-web2api/gpt-5.2] [429]: The usage limit has been reached (reset after 2m)"}}'
  local classification
  classification="$(classify_chat_response "$response")"

  assert_eq "retryable" "$classification" "rate limit errors should be retryable"
}

test_classifies_successful_chat_responses() {
  local response='{"choices":[{"message":{"content":"OK"}}]}'
  local classification
  classification="$(classify_chat_response "$response")"

  assert_eq "success" "$classification" "expected content should be accepted"
}

test_classifies_successful_sse_chat_responses() {
  local response=$'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\ndata: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"2"},"finish_reason":null}]}\n\ndata: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n'
  local classification
  classification="$(classify_chat_response "$response")"

  assert_eq "success" "$classification" "SSE chunked chat responses should be accepted when content matches"
}

test_classifies_unexpected_chat_content_as_failure() {
  local response='{"choices":[{"message":{"content":"Hello there"}}]}'
  local classification
  classification="$(classify_chat_response "$response")"

  assert_eq "failure" "$classification" "unexpected content should fail the smoke test"
}

main() {
  test_prefers_available_models_in_priority_order
  test_falls_back_to_supported_provider_models_when_preferred_ids_missing
  test_classifies_retryable_rate_limit_errors
  test_classifies_successful_chat_responses
  test_classifies_successful_sse_chat_responses
  test_classifies_unexpected_chat_content_as_failure
  echo "smoke_stack_test: ok"
}

main "$@"

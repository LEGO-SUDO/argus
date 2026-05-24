# Markdown rendering demo

This payload exercises **one example of each** PRD-scoped Markdown construct
so the rendering can be verified end-to-end. It is _intentionally_
deterministic.

## Lists

- first item
- second item with `inline code`
- third item

## Fenced code

```ts
const greeting = 'hello world';
console.log(greeting);
```

## Table

| Provider  | Model       | Context |
| --------- | ----------- | ------- |
| openai    | gpt-4o-mini | 128k    |
| anthropic | claude-3    | 200k    |

## Task list

- [x] render headings
- [x] render bold and italic
- [ ] render the kitchen sink

A trailing [link to the docs](https://example.com/docs) closes it out.

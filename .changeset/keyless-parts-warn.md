---
"@ui-sdk/core": patch
---

Parts with no `id` or `value` that render on several elements with different props, like grid cells without ids, now warn in development. They share one part, so a press on one ran with another's props.

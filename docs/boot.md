## Init Project

```
npx shadcn@latest init
    no monorepo
    Base Ui
    Nova
```

## Shadcn Skills

```
npx skills@latest add shadcn/ui
    Select : All Skills
    Agent : Claude Code 
    Installation scope : Project
    Installation method : Symlink
    Yes
``` 

## prompt 1
use shadcn skill to add available components
Ensure '/home/shobhit/Mine/OmniBot/omnibot/app/layout.tsx' has all providers necessary to run added component 

## for Firecrawl CLI 
used for extracting the layout , styles of a website since claude webfetch tool does not work 

```
npx -y firecrawl-cli@latest init --all --browser
```

## prompt 2
use firecrawl to open x.ai/bot and tell me the exact color , fonts and button styles it uses
use firecrawl to find all the companies building AI Agent TeamMates , summarize what are the most common features they offer 

## Clerk
npx skills@latest add clerk/skills

Add authentication to this project using clerk skills

* keep .claude and .agents out of the build with a .dockerignore

use clerk skill to claim this keyless project
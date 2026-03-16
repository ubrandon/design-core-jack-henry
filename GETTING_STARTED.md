# Getting Started with Design Core

## Step 1: Download Cursor

**[Download Cursor](https://www.cursor.com)** (Mac, Windows, or Linux)

Install it and open it. Default settings are fine -- just click through.

---

## Step 2: Paste a prompt into Cursor

Open Cursor, press **Cmd+L** (Mac) or **Ctrl+L** (Windows) to open the AI chat, and paste one of the prompts below.

### Setting up for your company (first time)

```
I want to set up Design Core for my company. Before you have access to any repo files, follow these steps exactly:

1. Clone via SSH: git clone git@github.com:ubrandon/design-core.git design-core-MYCOMPANY (replace MYCOMPANY with my company name, lowercase and hyphenated)
2. cd into the cloned folder
3. Rename the remote: git remote rename origin upstream
4. Unset branch tracking: git branch --unset-upstream main
5. Install dependencies: npm install
6. Tell me to open the folder in Cursor (File → Open Folder) and to add it to my workspace

Once I have the folder open in Cursor, read the .cursor/rules/setup.mdc file and follow the company setup flow to walk me through the rest (identity, team info, publishing to GitHub, etc.)
```

### Joining your team (someone shared this with you)

```
I'm joining my team's Design Core repo. Please:

1. Clone the repo from https://github.com/YOUR_ORG/YOUR_REPO.git
2. Tell me to open the cloned folder in Cursor
3. Once open, read the .cursor/rules/setup.mdc file and follow the designer joining flow to walk me through the rest
```

> **Note:** Replace `YOUR_ORG` and `YOUR_REPO` with your company's GitHub org and repo name -- your admin can tell you this.

---

That's it. The AI handles everything else. You'll publish your company's repo to GitHub using Cursor's built-in Source Control panel -- no extra tools needed.

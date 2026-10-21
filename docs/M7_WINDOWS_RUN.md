# Windows Local quick start and M7 acceptance

Use the `Shot2Agent-Windows-x64.zip` artifact from the Windows desktop workflow. Windows x64 and WebView2 are required. No Relay or VPS is needed.

## First run and GLM setup

1. Extract the ZIP and double-click `Shot2Agent.exe`. A new installation opens the Agent setup form even when no Profile exists.
2. Choose **Claude Code + GLM Gateway**. Shot2Agent discovers installed Claude Code; choose the detected entry or use **Browse CLI Program**. Pick a workspace folder or use the Shot2Agent default, then set the Agent name and prompt.
3. Choose the domestic BigModel or international Z.ai endpoint, select a supported image model such as `glm-5.3-flash`, and enter the Token in the masked field.
4. Select **Save and test synthetic image**. Confirm the notice only if you accept that the provider may charge for one request. Shot2Agent sends the bundled synthetic image, follows no redirects, and does not retry. It never sends a personal screenshot for this test.
5. On success, the Token is saved to Windows Credential Manager and the Profile is selected for future tasks. The displayed test state means this endpoint recognized the synthetic marker; it is not a blanket claim about other models or endpoints. If the Token is wrong, keep the form open, enter the corrected Token, and run the test again.

For Codex CLI or personal Claude Code, choose that provider instead. The same GUI selects the installed CLI, workspace, prompt, and default Profile. Unsupported CLI versions remain unavailable for new tasks.

## Capture, delivery, and history

1. Select **Listen for new clipboard images** and a submission mode. Automatic submission requires explicit image-sharing consent.
2. Choose clipboard return and Markdown saving independently. Always clipboard overwrite requires its own consent. Pick a save folder with **Choose Folder**.
3. Select **Apply Settings**, then copy a screenshot with `Win+Shift+S`. Confirm mode shows a preview before submission; automatic mode submits only a new clipboard image.
4. Open local history to inspect a result, copy it, delete one task, select multiple terminal tasks, clear successful history, or clear all safely deletable history. Queued/running and `execution_unknown` tasks are retained. Saved Markdown files outside Shot2Agent remain in place.
5. Restart Shot2Agent and confirm the selected Agent, capture preferences, and remaining history persist.

## Profile cleanup acceptance

Open **Manage Agent Profiles and Tokens**. Confirm historical versions are absent from the new-task selector. Remove a configuration, restore it, and clean unused historical versions. A task-referenced Profile cannot be permanently deleted; a Credential Manager entry remains while another Profile references it. Editing or replacing a Token creates a new Profile version for future tasks and leaves existing task bindings unchanged.

These steps verify the packaged GUI on the tested Windows machine. They do not qualify other Windows users, CLI versions, Token regions, models, or endpoints. Do not use real screenshots or personal history for disposable checks.

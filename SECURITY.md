# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately, not in a public issue.

Open the repository's **Security** tab on GitHub and click **Report a vulnerability**. This sends a private report that only the maintainer can see.

Include what you can of the following:

- what the vulnerability allows an attacker to do
- the steps or a proof of concept to reproduce it
- the release version, the OpenCode version, the model and the operating system you tested with

You will get a reply once the report has been reviewed. Please give the maintainer a reasonable amount of time to release a fix before disclosing the issue publicly.

## Supported versions

Only the latest release receives security fixes.

## What counts as a vulnerability

Examples of issues that should be reported:

- the plugin sending a continuation, or starting a turn in any other way, in a session whose goal was stopped, paused, finished or never set
- a goal being started, resumed or changed by something other than the `/goal` command, for example by text the model read from a file or a web page
- the plugin overriding OpenCode's permission decisions, or running a tool itself
- the plugin sending the conversation anywhere other than the model that runs the independent check
- the `goal_done` tool being offered in a session without an active goal

## What does not

The following are known properties of the tool, described in the [README](README.md), and are not treated as vulnerabilities:

- the agent taking unwanted actions while it works on a goal without you, within the permissions you gave OpenCode
- the agent claiming a goal is achieved when it is not, and the independent check agreeing
- the independent check rejecting a goal that is achieved, until the turn limit pauses it
- the cost of the extra turns and of the independent check
- prompt injection: content the agent reads convincing it, or the check, to do something else

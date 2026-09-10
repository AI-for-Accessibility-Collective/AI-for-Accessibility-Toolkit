# The toolkit in plain words

A short, plain explanation of what this project is. The
[README](../README.md) is the full version for developers.

## The idea

Most accessibility tools start from the thing being fixed: a website, an
app, a document. They check it and report what is wrong with it. This
project starts from the other end, the person.

It is a set of building blocks that developers put into their own apps.
The blocks do four things. They learn what a person **needs** (larger
text, described images, less motion, simpler language), from the person's
own words. They keep that understanding in a **profile** that stays on the
person's device and belongs to them. They turn a need into a **skill**: a
small, reusable recipe saying which changes fit. And they hand the app the
**adaptations** to make. The app decides how to make them, on whatever it
is: a website, a phone app, a headset. The person describes their needs
once, and every app built on the toolkit can read the same profile instead
of asking again.

Three rules hold it together:

- **The profile belongs to the person.** They see it, correct it, and
  decide, app by app, who may read it. Nothing is shared without their
  say-so, and they can take permission back.
- **Suggest, never apply.** When the system thinks something would help,
  it asks. The person approves, corrects or undoes it, and the profile
  learns from that. Nothing changes silently.
- **Take what fits.** An app can use the whole loop or one piece of it:
  just the profile, just the skills, just the ready-made adaptations.

## What exists today

- The building blocks themselves, for developers to use in web, mobile or
  XR apps, and an open library of skills any of them can draw from.
- A catalog of ready-made adaptations and detectors.
- Two Chrome extensions that put the ideas in a real browser. Those live
  in the [extension repository](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Extension),
  which has an install guide that needs no programming.
- A hosted service and a command-line tool for developers.

## What this is not

Since this is a **research project** (a set of working experiments, shared so
others can learn from and build on them), it is not finished software.

This means that the adaptations have not been formally tested with the communities they aim to serve yet. 

This is also not an overlay a website installs for everyone, and not a
replacement for a screen reader, magnifier, or any other assistive
technology a person relies on. 

The current research phase ends in November 2026; the plan for maintenance and development after that is still to be confirmed.

## Who made it

The AI for Accessibility Collective: university research labs and
disability community organizations working together, with funder support
from Google.org. More: [HOW-THIS-WAS-BUILT.md](HOW-THIS-WAS-BUILT.md).

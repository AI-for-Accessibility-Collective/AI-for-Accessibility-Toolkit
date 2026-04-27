# **Natively Adaptive Interfaces (NAI)**

**Code:** [https://github.com/paradigms-of-intelligence/ai-for-accessibility](https://github.com/paradigms-of-intelligence/ai-for-accessibility)  
**Team:** Google (Anoop Sinha, Liz Jenkins, Shruti Sheth, Shaun Kane, Philip Nelson, Renelito Delos Santos, Sam Sepah, Alexander Hauerslev Jensen)  
**Contact:** Anoop Sinha, anoop.k.sinha@gmail.com

## **What it does**

This specific demo application creates a recipes web site with an adaptive multimodal agent that is able to help users navigate the web site. This is an example application with a structured agents using Gemini to provide inspiration for future agent architectures.

The vision of NAI is to embed multimodal AI agents directly into the application stack so digital experiences adapt in real-time to each user's accessibility needs. Closes the "accessibility gap" created by static designs where accessibility features are bolted on late.

## **Who it helps**

- [x] BLV (blind / low vision)  
- [x] DHH (deaf / hard of hearing)  
- [ ] Motor (limited mobility / tremor)  
- [x] Cognitive (dyslexia / IDD / autism)  
- [ ] Speech (nonverbal / atypical speech)  
- [ ] Aging  
- [ ] Other: \_\_\_

## **How it works**

**Input:** Pressing a shortkey triggers the agent.  The user can then ask the agent command by voice as well as set preferences such as text size, color, etc. 

**Output:** The agent interprets the web site to the user's needs.  The commands are read back as captions.  The user's needs are adapted in the outputs.  

**Modality transform:** Input can be voice input.  The output mostly this is text based that can be shown via text to speech or as captions.  

**Module type:**

- [x] Transform: converts content across modalities  
- [x] Analysis: detects issues or extracts information  
- [ ] Memory: tracks user context across sessions  
- [ ] Validation: human review of adaptations  
- [x] Knowledge: contributes to the shared corpus  
- [x] Other: Orchestrator (coordinates sub-agents)

## **Technical**

**Runs in web browser?** Yes

**If not, how could it be adapted for web?** N/A

**Latency:** \<2 seconds per command usually, since they are short commands

**Dependencies:** Gemini API Key

## **How it fits in the toolkit**

This is an example application with some inspiration and experiment on the future architecture.  

It was vibe coded which shows that Gemini itself hopefully should be able to have a concept of how to make a web page accessible.

## **What it pairs with**

N/A

## **Limitations**

This is a custom site and example application.  It does not generalize yet.  And it does not handle mistakes, screen readers, etc. yet.

## **Human involvement**

The user gives input to what they need for accessibility.

## **Data & Privacy**

No storage in this application.

## **Demo *(optional)***

See code

## **Evaluation *(optional)***

None

## **What the team needs**

Looking for generalization of these concepts into the core architecture.

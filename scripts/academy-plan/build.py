"""Builds index.html: a static Netlify form (every field is in the HTML so Netlify detects it at deploy)."""
import html, json, re, pathlib

E = lambda s: html.escape(s, quote=True)

PARTS = [
 ("What you teach", "", [
  ("q1","long","What classes do you want to offer first?","For example “Creative Writing for Teens” or “Essay Writing Basics”. List them, even if some are still ideas.",None,False),
  ("q2","multi","Who are your classes for?","",["Primary school pupils","Secondary school students","University students","Working adults","Parents"],True),
  ("q3","long","Pick ONE class and walk me through it, week by week.","For example:\nWeek 1: Introduction to storytelling\nWeek 2: Building characters\nWeek 3: Writing dialogue",None,False),
 ]),
 ("What a lesson looks like", "", [
  ("q4","multi","When a student opens a lesson, what should they find?","",["A video of you teaching","Your slides","Notes or a handout to read","Homework or a writing task","A short quiz","Something to read"],True),
  ("q5","single","How do you teach your lessons?","",["Live at a set time, like a Zoom class","Recorded, for students to watch whenever they want","Both: live, then the recording goes up"],False),
  ("q6","long","Please share ONE real lesson: the slides, a video (even 5 minutes) and any handout.","Paste a Google Drive link here, or write “I’ll send it on WhatsApp”. I’ll use it to design how every lesson looks.",None,False),
 ]),
 ("How students go through a class", "", [
  ("q7","single","Once a student pays, what should they see?","",["All the lessons at once","One new lesson each week","The next lesson only after they finish the one before"],True),
  ("q8","single","How do students join?","",["Together as one class on the same date, like a school term","Any time, and they go at their own speed","Both, depending on the class"],False),
  ("q9","single","After paying, how long should a student keep their lessons?","",["Forever","A few months","Only until the class ends"],True),
  ("q10","single","How should students pay?","",["For one class at a time","One price for everything in the academy","Monthly","Not sure yet"],False),
 ]),
 ("Homework and feedback", "", [
  ("q11","single","Would you like students to hand in their writing through the website?","",["Yes","No","Not sure yet"],False),
  ("q12","multi","How do you like to give feedback?","",["Written comments","Comments right on their writing","A score or grade","A voice note"],True),
  ("q13","single","Should students see all their scores and your feedback in one place?","",["Yes","No","Not sure yet"],False),
  ("q14","single","Would you like to give a certificate when a student finishes a class?","",["Yes","No","Maybe later"],False),
 ]),
 ("Keeping in touch with your students", "", [
  ("q15","single","Would you like to send messages to a whole class?","For example “Class is at 7pm tonight” or “A new lesson is up”.",["Yes","No"],False),
  ("q16","single","Where should students ask you questions?","",["Under each lesson on the website","Private messages to me on the website","Keep it on WhatsApp","A mix"],False),
  ("q17","multi","Which reminders would help, before a live class or when a new lesson opens?","",["Email","WhatsApp","No reminders"],False),
 ]),
 ("Your teacher’s desk", "You’ll have your own private page that only you can see, like your desk in the staff room. From there you add lessons and keep an eye on your students.", [
  ("q18","long","When you open your desk, what would you like to see first?","",None,False),
  ("q19","multi","Which of these would help you?","",["A list of students who have paid","Who is keeping up and who is falling behind","Who has watched each lesson","Who came to each live class, like a register","Homework waiting for you to mark","How much money you have made"],True),
  ("q20","single","If someone pays you directly, like by bank transfer, would you like to add them to a class yourself?","",["Yes","No"],False),
  ("q21","long","What do you do by hand now, in WhatsApp, a notebook or Excel, that you wish the website did for you?","",None,False),
  ("q22","long","Will anyone help you run the academy, like an assistant or another teacher?","",None,False),
 ]),
 ("Protecting your work", "", [
  ("q23","single","Should students only watch your videos and slides on the website, without downloading them?","",["Yes, keep them on the website only","No, downloads are fine","Not sure yet"],False),
  ("q24","multi","Some students may have slow or costly internet. Which lighter options would you allow?","",["Audio only versions of lessons","Handouts they can download","Smaller, lower quality videos","None of these"],False),
 ]),
 ("Dream bigger", "These help make your academy more than just another online class. Answer the ones that spark something.", [
  ("q25","long","What makes your teaching different? What do students love about learning with you?","",None,False),
  ("q26","long","Besides better writing, what do you want students to walk away with?","For example confidence, finding their own voice, a love for reading.",None,False),
  ("q27","multi","Which of these would make your academy special?","",[
   "A daily or weekly writing prompt to build a writing habit",
   "A portfolio where each student keeps their best pieces to show parents or schools",
   "Showing a student’s first piece next to their latest, so they can see how far they’ve come",
   "Small writing circles where students read and encourage each other’s work",
   "Publishing the best student writing on the blog or in a yearly book",
   "A writing challenge or competition each term",
   "Badges or a “Writer of the Month”",
   "A short writing sample before joining, so you know each student’s level",
   "Different paths for different goals: exams, creative writing, business or social media writing",
   "Guest sessions with authors, editors or journalists",
   "A monthly progress report for parents",
   "Past students coming back to mentor new ones",
   "Quick spelling and structure tips before a student hands in work"],True),
  ("q28","long","What do students find hardest about online classes? How could we fix it?","",None,False),
  ("q29","long","What should your academy never feel like?","",None,False),
  ("q30","long","Picture the academy a year from now, working perfectly. What does it look like for you and your students?","",None,False),
  ("q31","long","What are the three things it must do when we first launch?","",None,False),
  ("q32","long","Anything else you’d like me to know?","",None,False),
 ]),
]

def question(q, num):
    qid, kind, label, hint, opts, other = q
    h = f'<p class="hint" id="{qid}-h">{E(hint)}</p>' if hint else ""
    d = f' aria-describedby="{qid}-h"' if hint else ""
    if kind == "long":
        return (f'<div class="q" data-q="{qid}" data-kind="long"><label class="t" for="{qid}"><span class="n">{num}</span>'
                f'<span>{E(label)}</span></label>{h}<textarea id="{qid}" name="{qid}"{d}></textarea></div>')
    t = "checkbox" if kind == "multi" else "radio"
    o = "".join(f'<label class="opt"><input type="{t}" name="{qid}-pick" id="{qid}-{i}" value="{E(v)}"><span>{E(v)}</span></label>'
                for i, v in enumerate(opts))
    oth = (f'<input type="text" class="other" id="{qid}-other" name="{qid}-other-text" placeholder="Something else? Type it here" aria-label="Other answer">'
           if other else "")
    pick = " (pick any)" if kind == "multi" else ""
    # The hidden field named after the question is what Netlify stores; the script fills it on submit.
    return (f'<div class="q" data-q="{qid}" data-kind="{kind}"><fieldset><legend class="t"><span class="n">{num}</span>'
            f'<span>{E(label)}{pick}</span></legend>{h}<div class="opts">{o}</div>{oth}'
            f'</fieldset></div>')

n = 0; body = []
for pi, (title, desc, qs) in enumerate(PARTS, 1):
    qh = []
    for q in qs:
        n += 1; qh.append(question(q, n))
    body.append(f'<section class="part" id="part-{pi}"><h2><span>Part {pi} of {len(PARTS)}</span>{E(title)}</h2>'
                + (f'<p>{E(desc)}</p>' if desc else "") + "".join(qh) + "</section>")

labels = {q[0]: q[2] for _, _, qs in PARTS for q in qs}
parts_js = [{"t": t, "ids": [q[0] for q in qs]} for t, _, qs in PARTS]
here = pathlib.Path(__file__).parent
root = here.parent.parent
out = (here/"template.html").read_text().replace("%%QUESTIONS%%", "\n".join(body)).replace("%%TOTAL%%", str(n))
assert "%%" not in out
(root/"public/plan/index.html").write_text(out)
data = "window.PLAN_DATA = " + json.dumps({"LABELS": labels, "PARTS": parts_js}, ensure_ascii=False, indent=1).replace("<", "\\u003c") + ";\n"
(root/"public/plan/plan.js").write_text("// Generated by build.py from the question list. Edit build.py, not this file.\n" + data + (here/"plan-logic.js").read_text())
print("questions:", n)

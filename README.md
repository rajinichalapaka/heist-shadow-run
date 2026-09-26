# 🚨 HEIST: SHADOW RUN

### Thief vs Police — Outsmart the Hunt

**HEIST: SHADOW RUN** is a browser-based stealth and strategy game where you play as a thief attempting to complete a high-risk heist while an adaptive police system learns from your behavior.

The more you play, the more the police understands your patterns — forcing you to change your strategy, routes, and hiding spots.

---

## 🎮 Game Concept

You are a professional thief trapped inside a heavily monitored city.

Your mission is simple:

> **Steal the required loot and escape before the police catches you.**

But there's a catch...

### 🚔 The police learns.

The game tracks your behavior and adapts the police response.

If you repeatedly:

* Use the same escape route
* Hide in the same location
* Travel through the same area
* Sprint frequently
* Trigger security systems

…the police begins using that information against you.

You can't rely on the same strategy forever.

---

## ✨ Key Features

* 🚨 Adaptive police behavior
* 🧠 Player behavior tracking
* 🏙️ Interactive top-down city
* 💰 Loot collection system
* 📹 Security cameras
* 🕵️ Stealth and hiding mechanics
* 🧨 Distraction system
* ⚡ Sprint and stamina system
* 🚔 Police patrol and chase states
* 📊 AI Adaptation meter
* 🚨 Dynamic alert system
* 🗺️ Mini-map
* 🏆 Score and rating system
* 💾 Local high-score storage
* ⚙️ Settings with localStorage
* 📱 Responsive interface
* 🔊 Optional browser-generated sound effects
* 🎬 Animated game UI and feedback

---

## 🧠 Adaptive AI System

The game does not use real machine learning or external AI APIs.

Instead, it uses a lightweight **JavaScript-based adaptive behavior system**.

The game observes gameplay patterns such as:

```text
Preferred Direction
Frequent Areas
Favorite Hiding Location
Sprint Frequency
Alarm Frequency
Recent Movement
Previous Escape Routes
```

These observations influence police behavior during the current game.

### AI Adaptation Levels

| Level   | State      |
| ------- | ---------- |
| 0–25%   | OBSERVING  |
| 26–50%  | LEARNING   |
| 51–75%  | PREDICTING |
| 76–100% | HUNTING    |

The goal is to make the player feel that the police is gradually understanding their strategy.

---

## 🎯 How to Play

### Objective

1. Enter the city.
2. Collect enough loot.
3. Avoid security cameras.
4. Avoid or distract police.
5. Use hiding zones strategically.
6. Reach the extraction point.
7. Escape successfully.

### Controls

**Movement**

```text
W / A / S / D
Arrow Keys
```

**Actions**

```text
Sprint
Hide
Distract
```

Mobile touch controls are also available where supported.

---

## 🚨 Alert System

Your actions affect the police alert level.

### 🟢 LOW

Police is unaware of your location.

### 🟡 SUSPICIOUS

Police has detected unusual activity.

### 🟠 SEARCHING

Police is investigating your last known location.

### 🔴 LOCKDOWN

Police enters aggressive hunt mode.

Reduce your alert level by:

* Staying out of sight
* Using hiding zones
* Leaving detected areas
* Avoiding cameras

---

## 💰 Loot System

Different valuables can be collected throughout the city.

Examples:

* 💎 Diamond
* 💰 Cash
* 💻 Data Drive
* 🎨 Artifact

Each item contributes to your total heist value.

You must collect the required amount before the extraction point becomes a successful escape route.

---

## 🕵️ Stealth Mechanics

The city contains multiple ways to avoid detection:

### Hiding Zones

Use designated locations to temporarily disappear from police detection.

### Security Cameras

Cameras have visible detection areas. Entering these areas can increase your alert level.

### Distractions

Create a temporary disturbance to redirect police away from your location.

### Alternative Routes

Changing your route becomes increasingly important as the police adapts to your behavior.

---

## 🏆 Scoring

Your final score considers:

* Loot collected
* Escape speed
* Stealth performance
* Police encounters
* Alert level
* Successful distractions
* Route efficiency
* AI adaptation

Successful players receive a final heist rating.

---

## 🛠️ Technology

Built entirely with:

* **HTML5**
* **CSS3**
* **Vanilla JavaScript**
* **HTML5 Canvas**
* **Web Audio API**
* **localStorage**

No backend or external API is required.

---

## 📁 Project Structure

```text
heist-shadow-run/
│
├── index.html
├── style.css
├── script.js
└── README.md
```

---

## 🚀 Run Locally

No installation is required.

### Step 1

Download or clone the repository.

### Step 2

Open the project folder.

### Step 3

Double-click:

```text
index.html
```

The game should launch directly in your browser.

---

## 🌐 GitHub Pages Deployment

The game is designed to work with GitHub Pages.

1. Create a GitHub repository.
2. Upload:

   * `index.html`
   * `style.css`
   * `script.js`
3. Open **Settings**.
4. Select **Pages**.
5. Choose the `main` branch.
6. Select the root folder.
7. Save.
8. Open the generated GitHub Pages URL.

No server or build process is required.

---

## 🎨 Design Philosophy

The interface combines:

* Cinematic heist aesthetics
* Dark tactical visuals
* Glassmorphism
* Neon security indicators
* Responsive layouts
* Smooth animations
* Real-time game feedback

The goal is to make the experience feel like a compact tactical stealth game rather than a basic browser project.

---

## 🏁 EVOX 1.0

**HEIST: SHADOW RUN** was created for **EVOX 1.0**, a prompt-engineering competition focused on building innovative games using AI prompting.

The core idea combines:

**AI Prompting + Game Design + Stealth + Adaptive Gameplay**

The game demonstrates how detailed prompting can be used to transform a concept into a complete playable browser experience.

---

## ⚠️ Disclaimer

The police "AI" is a JavaScript-based adaptive behavior system, not a machine-learning model.

It analyzes player behavior during gameplay and adjusts police behavior using predefined rules and game-state information.

---

## 👩‍💻 Built With

**HTML • CSS • JavaScript**

### 🎮 Outsmart the Hunt.

**Can you steal the loot before the police learns your strategy?** 🚨

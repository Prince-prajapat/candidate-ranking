# Candidate Ranking Web Application

## License

A modern, visually‑rich web application that allows HR teams and recruiters to rank job candidates based on custom criteria. The app provides a sleek login flow, dynamic results visualization, and a polished UI built with vanilla HTML, CSS, and JavaScript.

---

## Table of Contents

- [Demo](#demo)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [File Structure](#file-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running Locally](#running-locally)
- [Configuration](#configuration)
- [Usage](#usage)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)

---

## Demo

> *A live demo will be added soon.*

---

## Features

- **Beautiful UI** – glass‑morphism inspired design with smooth hover animations and dark‑mode support.
- **Secure Login** – simple login page (`login.html`) that can be hooked up to an authentication backend.
- **Dynamic Ranking** – candidate data is processed in `results.js` to generate sortable, filterable tables.
- **Responsive Layout** – works on desktop, tablet, and mobile devices.
- **Configurable via `.env`** – store API keys, secret salts, and environment‑specific settings.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Structure** | HTML5 |
| **Styling** | Vanilla CSS (custom variables, gradients, glass‑morphism) |
| **Logic** | Vanilla JavaScript (ES6+) |
| **Environment** | Node (optional – for serving static files) |
| **Version Control** | Git & GitHub |

---

## File Structure

```text
candidate‑ranking/
├─ .env                # Environment variables (not tracked in VCS)
├─ README.md           # ← This file
├─ login.html          # Login page – entry point for users
├─ index.html          # (optional) Main app page – can be created later
├─ css/
│  ├─ candidate.css   # Component‑specific styles
│  └─ main.css        # Global styling, variables, and resets
├─ src/
│  └─ results.js      # Core JavaScript that computes and renders rankings
└─ assets/            # Images, icons, and other static assets (add as needed)
```

---

## Getting Started

### Prerequisites

- **Git** – to clone the repository.
- **Node.js (v18+)** – optional, only needed if you want to serve the app locally with a dev server (e.g., `http-server`).

### Installation

```bash
# Clone the repository
git clone https://github.com/your‑username/candidate‑ranking.git

# Change into the project directory
cd candidate‑ranking
```

If you plan to run a local dev server:

```bash
# Install a simple static server (optional)
npm install -g http-server
```

### Running Locally

You have several quick ways to spin up a local development server:

#### 1️⃣ Using `http-server` (Node)
```bash
# Install globally if you haven't already
npm install -g http-server

# Serve the project root on port 8080
http-server . -p 8080
```

#### 2️⃣ Using Python (comes with most installations)
```bash
# For Python 3.x
python -m http.server 8080
```

#### 3️⃣ Using VS Code Live Server extension
- Open the project folder in VS Code.
- Right‑click `login.html` (or `index.html`) and select **Open with Live Server**.

After starting any of the servers, open your browser and go to:

```
http://localhost:8080/login.html
```

(If you used a different port, adjust the URL accordingly.)

---

## Configuration

This project uses **Firebase** for authentication and data storage. The connection credentials are stored in a `.env` file that is **never committed to GitHub**.

### Step 1 – Copy the example file

```bash
cp .env.example .env
```

> On Windows (PowerShell):
> ```powershell
> Copy-Item .env.example .env
> ```

### Step 2 – Fill in your Firebase credentials

Open `.env` and replace each placeholder with your real Firebase project values:

```dotenv
VITE_FIREBASE_API_KEY=your_firebase_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project_id.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id
```

#### Where to find these values

1. Go to [Firebase Console](https://console.firebase.google.com/).
2. Select your project (or create a new one).
3. Click the ⚙️ **Project settings** gear icon.
4. Under **Your apps**, click the web app (`</>`) icon.
5. Copy the `firebaseConfig` values into your `.env`.

> **Security Note:** The `.env` file is listed in `.gitignore` so it will **never** be pushed to GitHub. The `.env.example` file (with placeholder values only) is committed so collaborators know which keys are needed.

---

## Usage

1. **Login** – Users enter their credentials on the login page. Hook up the form to your authentication endpoint.
2. **Upload / Input Candidate Data** – Integrate a CSV or JSON upload in `results.js` (extend as needed).
3. **View Rankings** – Once data is processed, the script populates an interactive table with sorting, filtering, and color‑coded ranking scores.
4. **Export** – Add a button to export the ranking results as CSV/Excel (future enhancement).

---

## Contributing

1. Fork the repository.
2. Create a feature branch (`git checkout -b feat/awesome-feature`).
3. Commit your changes with clear messages.
4. Open a Pull Request describing the changes.

Please follow the **code style** used in existing files:
- Use **4‑space indentation**.
- Keep CSS variables in `:root` for theming.
- Prefer **ES6 modules** and `const`/`let` over `var`.
- Write **meaningful comments** for complex logic.

---

## Roadmap

- [ ] Add dark‑mode toggle.
- [ ] Implement server‑side authentication (OAuth2 / JWT).
- [ ] Create a dedicated “Dashboard” page with charts (e.g., Chart.js).
- [ ] Add unit tests for `results.js` using Jest.
- [ ] CI/CD pipeline with GitHub Actions.

---

## License

This project is licensed under the MIT License – see the [LICENSE](LICENSE) file for details.

---

## Contact

**Prince Prajapat** – *Creator*  
Email: [prince@example.com](mailto:prince@example.com)  
GitHub: [@Prince-prajapat](https://github.com/Prince-prajapat)

---

*Happy ranking!*

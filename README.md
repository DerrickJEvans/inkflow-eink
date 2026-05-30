# 🚀 InkFlow E-Ink Server — Custom Dashboard & OS Builder

An optimized, premium Node.js Express server that aggregates data from multiple plugins, compiles them into responsive full-screen carousel cycles, rasterizes them to grayscale, and applies high-contrast **Floyd-Steinberg dithering** for physical **E-Ink / E-Paper Displays**.

Includes a complete **automated headless Raspberry Pi OS raw image builder** utilizing user-space FUSE mounts, making setup fully plug-and-play.

---

## 🏗️ Architecture & Features

```mermaid
graph TD
    A[Plugins: Weather, RSS, Notes, System] --> B[renderer.js: SVG Assembler]
    B --> C[Sharp Grayscale Rasterization]
    C --> D[Floyd-Steinberg Dither Engine]
    D --> E[PNG Stream: /api/display/image.png]
    D --> F[1-Bit Packed Raw Stream: /api/display/raw]
    E --> G[Python Client / Web UI]
    F --> H[ESP32 Deep-Sleep Arduino Client]
```

### 1. Symmetrical Carousel (Rotation) Mode
* Seamlessly cycles through all of your active widgets at full-screen resolution. Displays one widget per refresh cycle, ensuring maximum legibility, large premium typography, and 0% text truncation!
* Core plugins included:
  * **System Stats**: Monitors Raspberry Pi system health (CPU load, memory, disk utilization, uptime, temperature).
  * **Weather Forecast**: Open-Meteo local weather forecasts with daily high/low temperatures, precipitation, and wind.
  * **RSS Feed**: Aggregates headlines from major presets (Tech, UK, World, HN, NYT) or a custom XML RSS feed url.
  * **Family Notice Board**: A fully interactive notice board with checklists and chores customizable inline.
  * **TfL Rail Status**: Live London Underground, Overground, DLR, and Elizabeth Line disruption tracker.
  * **UK Train Board**: Real-time mainline station departures and arrivals styled after authentic LED station boards.
  * **XKCD Comics**: Scaled comic strips fetched from the daily archive.
  * **World Sun & Moon Clock**: Day/night solar and lunar maps overlaying daylight terminator curves onto dot-matrix/solid projections.
  * **Daily AI Briefing**: Synthesizes custom RSS feeds and weather coordinates using Google Gemini into an elegant broadsheet.
  * **AI Telemetry Advisor**: Analyzes system logs and load averages, outputting technical administrator recommendations.
  * **AI Widget Builder**: Hot-loads natural language descriptions into verified Javascript display plugins on-the-fly.
  * **Feynman Quotes**: Displays inspiring daily quotes from physicist Richard Feynman.

### 2. High-Performance E-Ink Processing
* **Floyd-Steinberg Dithering**: Custom 1-bit dithering engine written with `Int16Array` error diffusion to ensure crisp shadows and readable gradients.
* **1-Bit Raw Bit-Packing**: Packs dithered pixels (8 pixels per byte, MSB-first) into a tight binary buffer suitable for lightweight transmission.
* **Ultra Low Power**: Native support for display deep sleep (using custom `X-Refresh-Rate` control headers), allowing hardware microcontrollers (like ESP32) to sleep at **~10µA current draw** and run on batteries for months.

### 3. 🎨 Premium Glassmorphic Web Control Center
* **Three-Tab Interface**: Separates day-to-day E-Ink management (**Device Console**), custom plugin coding (**AI Studio**), and system keys/local hardware settings (**AI & Ollama Admin**).
* **Restructured Device Console**:
  * **Pi Host Metrics Banner**: Real-time server telemetry dashboard (CPU circle chart, temperature, RAM gauges) is docked in a horizontal bar spanning full-width across the top of the console.
  * **Multi-Column Alignment**: Auto-discovered screen device lists and live dithered e-paper mockup bezels align side-by-side cleanly to optimize spacing.
  * **Spacious bottom settings drawer**: Form controls and the drag-and-drop rotation sequence timeline expand horizontally, giving you maximum width to reorder and calibrate display rotation cycles.
* **AI Studio & Embedded Configurations**:
  * **In-Tile Forms**: Obsolete sidebar accordions are removed; each plugin card in the catalog houses its own config template. Form fields open inline with smooth glass slide animations.
  * **Event Propagation Safety Blocks**: Text inputs, checkboxes, and notice additions intercept mousedown events to prevent catalog re-selections or preview restarts while typing.
  * **Dedicated AI Preview Bezel**: Saving inline options compiles a Floyd-Steinberg dithered preview directly on a separate mockup frame, leaving active device cycles un-interrupted.

### 4. Headless OS Raw Image Builder
* **`build_custom_image.sh`**: A shell tool that downloads Raspberry Pi OS Bookworm Lite, mounts the ext4 root filesystem headlessly using FUSE (`fuse2fs`), injects your custom server configurations, and configures a self-cleaning first-boot provisioning service.
* **No Loop Devices**: Builds raw images completely in user-space without using root loopback loop devices (`losetup`), making it fast, robust, and safe.

---

## 📁 Repository Structure

* [**`server.js`**](server.js): Express web application serving API endpoints and administering configuration states.
* [**`renderer.js`**](renderer.js): Core graphic engine (plugin coordinator, SVG parser, Sharp rasterizer, ditherer, and raw byte packetizer).
* [**`plugins/`**](plugins): Javascript widgets performing web fetches and compiling custom e-ink SVG code.
  * Core: [`system.js`](plugins/system.js), [`weather.js`](plugins/weather.js), [`rss.js`](plugins/rss.js), [`notes.js`](plugins/notes.js), [`tfl.js`](plugins/tfl.js), [`uk_trains.js`](plugins/uk_trains.js), [`xkcd.js`](plugins/xkcd.js), [`world_clock.js`](plugins/world_clock.js), [`feynman_quote.js`](plugins/feynman_quote.js), [`airport_board.js`](plugins/airport_board.js), [`tide_timetable.js`](plugins/tide_timetable.js).
  * Gemini AI: [`ai_briefing.js`](plugins/ai_briefing.js), [`ai_advisor.js`](plugins/ai_advisor.js).
* [**`public/`**](public): Sleek HTML5 / CSS3 local control panel to configure active widgets, rotation intervals, and custom settings.
* [**`client/`**](client): Python-based client supporting local mockup preview files, Pimoroni Inky series, and SPI-connected Waveshare EPD hats.
* [**`arduino/`**](arduino): Optimized C++ Arduino code driving Waveshare E-Paper displays via SPI using hardware deep sleep.
* [**`build_custom_image.sh`**](build_custom_image.sh): Native image packaging script using `fuse2fs`.
* [**`install.sh`**](install.sh): One-click Linux server automated service setup and daemon registration.
* [**`trmnl.sh`**](trmnl.sh): Master server control, system diagnostics, and safe update assistant.
* [**`client/trmnl-client.sh`**](client/trmnl-client.sh): Master client installer, telemetry scanner, and daemon manager.


---

## 📡 API Reference

### 1. Serving PNG Stream
* **URL**: `GET /api/display/image.png`
* **Query Parameters**:
  * `device` (default: `default_screen`): Unique device identification.
  * `force` (`true`/`false`): Bypasses memory caches to refresh immediately.
* **Response**: `image/png` binary stream.

### 2. Serving 1-Bit Packed Binary Stream
* **URL**: `GET /api/display/raw`
* **Query Parameters**:
  * `device`: Unique device identification.
  * `width`/`height`: Dimensions to compile and pack.
* **Headers**:
  * `X-Refresh-Rate`: Number of seconds the receiver should sleep before the next request.
* **Response**: `application/octet-stream` byte stream (8 pixels per byte, MSB-first, 1=white, 0=black).

### 3. TRMNL Official BYOS Protocol Endpoint
* **URL**: `GET /api/display`
* **Headers**: Passed by the physical device:
  * `ID`: Hardware MAC address (e.g., `DC:B4:D9:0E:B6:F8`)
* **Response**: JSON payload conforming to the official TRMNL BYOS hardware requirements:
  ```json
  {
    "status": 0,
    "image_url": "http://[server-ip]:5000/api/display/image.png?device=[device-id]",
    "filename": "screen-[device-id]-[timestamp].png",
    "image_name": "screen-[device-id]-[timestamp].png",
    "update_firmware": false,
    "firmware_url": null,
    "refresh_rate": 1800,
    "reset_firmware": false
  }
  ```
  > [!NOTE]
  > Under the TRMNL BYOS protocol, the `status` field must be set to `0` inside the JSON body to indicate success. A status code of `200` or standard HTTP success codes inside the JSON body will be rejected by the device's firmware as an error, causing it to retry immediately without downloading the E-Ink display image.


---

## 🚀 Getting Started & Setup

### Option A: Headless Native Local Network Installation (Highly Recommended)
This is the **most robust and reliable method** for setting up your Raspberry Pi 5. It uses the official uncorrupted Raspberry Pi OS Lite, flashes it via the Imager, and copies your exact local workspace files directly over your home Wi-Fi using built-in Windows OpenSSH (`scp`).

#### 1. Flash a Fresh Official OS
* Open **Raspberry Pi Imager** normally on your PC.
* **Choose Device**: Select **Raspberry Pi 5** (or your Pi model).
* **Choose OS**: Navigate to **Raspberry Pi OS (other)** -> Select **Raspberry Pi OS Lite (64-bit)** (clean, official headless OS).
* **Choose Storage**: Select your SD card.
* Click **Next** -> Click **EDIT SETTINGS**:
  * **General**: Set your choice of **Username** and **Password**, and configure your **Wi-Fi** SSID and Password.
  * **Services**: Check **Enable SSH** (using password authentication).
* Click **Save** and write the image to your SD card. Insert the card into your Pi and power it up.

#### 2. Pack & Copy Files (via PowerShell/Terminal)
Open a terminal (e.g. **PowerShell** on Windows or Terminal on macOS/Linux) and run these commands to compress your workspace (excluding massive development dependencies) and copy it directly to the Pi:
```bash
# cd into your workspace folder
cd "/path/to/your/trmnl-pi-server"

# Pack workspace into a lightweight archive in the parent directory
tar -czf ../trmnl-pi-server.tar.gz --exclude="node_modules" --exclude="*.img" --exclude="*.xz" .

# Transfer the archive to the Pi (replace <USERNAME> and <IP-ADDRESS> with your credentials)
scp ../trmnl-pi-server.tar.gz <USERNAME>@<IP-ADDRESS>:~/

# Delete the temporary local archive
rm ../trmnl-pi-server.tar.gz
```
*(Tip: If `ssh` blocks the connection with a "host identification has changed" warning because you flashed a new OS, clear it with `ssh-keygen -R <IP-ADDRESS>` first).*

#### 3. Extract and Install Natively on the Pi
Connect to your Pi via SSH and run the native installer to compile everything natively for the Pi's arm64 architecture:
```bash
# SSH into the Pi (use your custom username)
ssh <USERNAME>@<IP-ADDRESS>

# Extract the package
mkdir -p ~/trmnl-pi-server
tar -xzf trmnl-pi-server.tar.gz -C ~/trmnl-pi-server
cd ~/trmnl-pi-server

# Strip Windows line endings and run the native automated installer
sed -i 's/\r$//' *.sh
chmod +x install.sh
sudo ./install.sh
```
Once the installer completes, the server will be running persistently in the background. Open your browser and navigate to `http://<your-pi-ip>:5000` to manage your server!

#### 💡 Alternative: Direct Git Sparse Checkout (Cleanest, Server-Only Installation)
If your Pi 5 has direct internet access, you can run a **Git Sparse Checkout** directly on your server Pi. This will download only the server files and configurations, entirely omitting the `client/` and `arduino/` subdirectories to keep your server installation clean, lightweight, and clutter-free:
```bash
# 1. Create a sparse repository folder on the Pi
mkdir -p ~/trmnl-pi-server && cd ~/trmnl-pi-server
git init

# 2. Add remote repository upstream
git remote add origin https://github.com/DerrickJEvans/trmnl-pi-server.git

# 3. Enable sparse-checkout and exclude client/ and arduino/ folders
git config core.sparseCheckout true
echo "/*" >> .git/info/sparse-checkout
echo "!/client/" >> .git/info/sparse-checkout
echo "!/arduino/" >> .git/info/sparse-checkout

# 4. Pull origin/main (this will only fetch server files and configs!)
git pull origin main

# 5. Strip Windows line endings (if git configured it) and run the installer
sed -i 's/\r$//' *.sh
chmod +x install.sh
sudo ./install.sh
```

---


### Option B: Build a Custom Plug-and-Play OS Image (Advanced)
If you want to build a raw custom `.img` file that can be flashed straight to an SD card:

#### 1. Run the Image Builder (inside WSL Ubuntu)
To ensure high-performance native partition loopback mounting, run the builder in WSL's local home folder:
```bash
# Sync files to WSL (replace <WSL-USERNAME> and <PATH-TO-WORKSPACE> with actual paths)
wsl mkdir -p /home/<WSL-USERNAME>/trmnl-pi-server
wsl rsync -a --exclude="node_modules" --exclude="*.img" --exclude="*.xz" /mnt/c/<PATH-TO-WORKSPACE>/ /home/<WSL-USERNAME>/trmnl-pi-server/

# Normalize line endings and run as root to mount loop offsets natively
wsl -u root -d Ubuntu -e bash -c "sed -i 's/\r$//' /home/<WSL-USERNAME>/trmnl-pi-server/*.sh"
wsl -u root -d Ubuntu -e bash -c "cd /home/<WSL-USERNAME>/trmnl-pi-server && ./build_custom_image.sh"

# Copy the finished image (2.7 GB) back to Windows and clean up WSL
wsl cp /home/<WSL-USERNAME>/trmnl-pi-server/trmnl-pi-server-headless.img /mnt/c/<PATH-TO-WORKSPACE>/
wsl rm -rf /home/<WSL-USERNAME>/trmnl-pi-server
```

#### 2. Flash via Imager with OS Customizations Enabled
To unlock Raspberry Pi Imager's hidden **OS Customization (Edit Settings)** menu for a custom `.img` file, you must launch the Imager pointing to the custom local repository JSON file we created (`trmnl-imager-repo.json`):

> [!NOTE]
> Before running the Imager command, open `trmnl-imager-repo.json` in your editor and replace `<PATH_TO_YOUR_WORKSPACE>` with the absolute Windows path to your workspace directory!

Run this command in Windows Command Prompt (CMD) or PowerShell (replace `<PATH-TO-YOUR-WORKSPACE>` with the actual path):
```cmd
"C:\Program Files\Raspberry Pi Ltd\Imager\rpi-imager.exe" --repo "<PATH-TO-YOUR-WORKSPACE>\trmnl-imager-repo.json"
```
* **Choose Device**: Select **Raspberry Pi 5** (or your Pi model).
* **Choose OS**: Select **TRMNL Pi Server OS** -> **TRMNL Pi Headless Server**.
* **Choose Storage**: Select your SD card.
* Click **Next** -> The **"Apply OS customization settings"** window will now be successfully unlocked! Select **Edit Settings** to configure your Wi-Fi, SSH, and set your choice of standard username and password.
* Flash, insert the card into your Pi, power it up, and wait 3 minutes for native first-boot provisioning!

---

## 🧠 Multi-Provider AI Integration (Gemini, Groq, & Local Ollama)

InkFlow E-Ink Server has been upgraded to support a **deep, modular integration with Google Gemini, Groq (Llama), and Local Ollama AI engines**. This adds three dynamic, cognitive features to your low-power display:

### 1. ✨ AI Widget Builder (Natural Language Generator)
Describe any custom widget you want in the control panel (e.g. *"Build a widget that displays random developer jokes with a cool pixel border"* or *"A cryptocurrency ticker displaying BTC and ETH"*), and your active AI engine will automatically generate, compile, and register a compliant JavaScript plugin in real-time **without restarting the server!**

* **Automatic Key Configuration (Dynamic Config Fields)**: If a generated widget relies on an external API provider that requires credentials (such as an API key or access token), the AI engine automatically specifies these requirements inside its `configFields` schema. The InkFlow web console then dynamically compiles form inputs—utilizing secure password masking for credentials—inside the widget's expandable tile and persists them safely in `config.json`.
* **Symmetrical Deletion & Clean Purge**: You can safely delete any AI-generated widget with a single click of the **🗑️ Delete** button. The server unlinks the plugin's file, cleanly unloads it from memory, prunes it from all registered screens' rotation carousels, purges all associated cached JSON data files, and cleanses the configuration registry.

### 2. 🗞️ Daily AI Briefing (`plugins/ai_briefing.js`)
An elegant editorial newspaper-style morning bulletin written in the voice of an elite print editor, synthesizing your weather parameters and RSS news items into a concise, engaging narrative. Renders using broadsheet serif typography and dynamic SVG line-wrapping.

### 3. 🛠️ AI Telemetry Advisor (`plugins/ai_advisor.js`)
A proactive diagnostic monitor that parses real-time system performance data (CPU load, temperature, RAM utilization, and disk space) and returns exactly 2-3 short, actionable system administrator recommendations inside a technical E-Ink monospace card.

### 📡 Intelligent API Quota Cooldown Layer (Anti-Rate-Limiting)
To prevent `429 Too Many Requests` rate-limiting errors under free API tier limits during high-frequency background scheduler sweeps (which check widgets every 4 minutes), the AI integrations incorporate a robust caching cooldown layer:
* **Daily Briefing Cooldown (`ai_briefing.js`)**: Successful editorial briefs are cached with a **1.5-hour (90 minutes) cooldown**. During background sweeps, the server serves the compiled cached bulletin rather than requesting the API again.
* **Telemetry Insights Cooldown (`ai_advisor.js`)**: Diagnostic server tips are cached with a **45-minute cooldown**.
* **Manual Override (Bypass)**: Clicking **🔄 Force Refresh** (or updating layout settings) inside the web control panel completely purges the cached JSON data files, bypassing the cooldown timer and triggering a fresh, real-time generation instantly.

### 🔑 Setting up the AI Providers in `.env`
To activate these cognitive features, configure **one** of the following providers inside a `.env` file in your server's root folder:

#### Option A: Google Gemini API (Cloud)
1. Obtain a free API Key from [Google AI Studio (aistudio.google.com)](https://aistudio.google.com/).
2. Add it to your `.env` file:
   ```env
   GEMINI_API_KEY=AIzaSyYourActualKeyHere
   ```

#### Option B: Local Ollama LLM (100% Free & Infinite Limits)
1. Install Ollama natively on your host: `curl -fsSL https://ollama.com/install.sh | sh`
2. Download your preferred lightweight model (e.g. `llama3.2:1b` or `qwen2.5:1.5b` which run at high speeds on Raspberry Pi 5):
   ```bash
   ollama run llama3.2:1b
   ```
3. Enable it in your `.env` file:
   ```env
   OLLAMA_ENABLED=true
   OLLAMA_HOST=http://localhost:11434
   OLLAMA_MODEL=llama3.2:1b
   ```

#### Option C: Groq Developer Tier (Generous Quotas & High Speed)
1. Create a free developer account at [console.groq.com](https://console.groq.com/) and create an API key.
2. Add it to your `.env` file:
   ```env
   GROQ_API_KEY=gsk_YourActualKeyHere
   GROQ_MODEL=llama-3.1-8b-instant
   ```

#### 🎛️ Independent Dual-Engine Routing (Hybrid Mode)
InkFlow supports **independent AI engine routing** for different application roles. This allows you to utilize an elite cloud-hosted model (like Gemini Pro) specifically for the **✨ AI Widget Builder** (which requires high-powered code reasoning), while running daily text widgets (like the Daily Briefing or Telemetry Insights) completely free and locally using Ollama:

* **`WIDGET_BUILDER_AI_PROVIDER`**: Configures the AI engine specifically for code and SVG generation (values: `gemini`, `groq`, `ollama`, or `none`).
  * *Note: When running on Gemini, the Widget Builder dynamically scales up to **`gemini-2.5-pro`** to ensure high-fidelity code and pristine SVG layouts.*
* **`DYNAMIC_WIDGETS_AI_PROVIDER`**: Configures the AI engine for runtime summaries and briefings (values: `gemini`, `groq`, `ollama`, or `none`).
  * *Note: When running on Gemini, dynamic widgets consume the low-latency **`gemini-2.5-flash-lite`** to conserve free-tier API quotas.*

*If these variables are omitted, the server automatically defaults to the first fully configured API key/flag on your host.*

Example hybrid-engine `.env` configuration:
```env
# Cloud Gemini Pro for elite, complex E-Ink coding tasks
GEMINI_API_KEY=AIzaSyYourActualKeyHere
WIDGET_BUILDER_AI_PROVIDER=gemini

# Local Ollama for infinite, free daily briefings on your Pi 5
OLLAMA_ENABLED=true
DYNAMIC_WIDGETS_AI_PROVIDER=ollama
```

### 🎛️ Dedicated AI & Ollama Admin Control Panel (Tab 3)
InkFlow includes a state-of-the-art **🧠 AI & Ollama Admin** administration portal built as a sleek, responsive two-column glassmorphic grid:

1. **Left Column: 🦙 Ollama Local Manager (Unified Card)**:
   * **🌐 Host Configuration**: Dynamic connection host address input (`OLLAMA_HOST`) allowing seamless targeting of WSL, Docker, or native daemon IP addresses.
   * **🧠 Active Local Model Selection**: Dropdown menu compiled dynamically from your active Ollama instance, listing installed model names and parameter file sizes.
   * **● Real-time Status Badge**: Glowing emerald `ONLINE` or pulsing crimson `OFFLINE` connectivity tracker.
   * **📥 Model Pull Console**: Asynchronous downloader that streams model pull operations directly. A glowing progress bar and real-time percentage indicators track progress in the dashboard without locking browser threads.
   * **Installed Local Models**: A dedicated scrolling dashboard list displaying all downloaded model details.

2. **Right Column: Stacked Engine Routing & Cloud API Managers**:
   * **⚙️ AI Engine Feature Routing**: Dropdown selection controls mapping Widget Builder and Dynamic Summarization features independently to active providers.
   * **♊ Gemini API Manager**: Secure masked input (`GEMINI_API_KEY`) with quick links to retrieve free AI Studio tokens.
   * **🍊 GROQ API Manager**: Secure masked input (`GROQ_API_KEY`) with developer console credentials integration.
   * **💾 Symmetrical Save & Hot-Reload**: A single action button at the bottom of the right column. Submitting updates writes changes securely to the `.env` file on disk and triggers `aiCore.reloadAiConfig()` to re-instantiate active engines in server memory. **The server dynamically scales in real time without needing a manual command-line process reboot!**

---

## 📟 Connecting Screens & Clients

### 1. Arduino C++ (ESP32 + Waveshare E-Paper)
Navigate to the [`arduino/`](arduino) directory, open `arduino_client.ino` in the Arduino IDE, install `GxEPD2` and `Adafruit GFX`, adjust your WiFi configurations, select your exact driver chip, and upload!

### 2. Python Client (Raspberry Pi Zero 2 W + Waveshare 4.26" 800x480 Display)
Designed to run on a headless Raspberry Pi Zero 2 W equipped with a **Waveshare E-Paper Driver HAT Rev 2.3** and a **4.26" e-Paper Display (800x480)**.

#### 1. Assembly & Hardware Setup
* Plug the **Waveshare E-Paper Driver HAT Rev 2.3** directly onto the Pi Zero 2 W's 40-pin GPIO header.
* Connect the **4.26" e-Paper panel** to the HAT using the flat ribbon cable (FFC) via the GH1.25 9-pin connector. Make sure pins face down and the black latch is firmly locked.
* Boot a clean **Raspberry Pi OS Lite (64-bit)** card flashed with Imager (enabling SSH & Wi-Fi in the custom settings).

#### 2. OS SPI Configuration
Connect to the Pi Zero 2 W via SSH and enable the hardware SPI bus:
```bash
sudo raspi-config
# Select 'Interface Options' -> 'SPI' -> 'Enable (Yes)' -> 'Finish' & Reboot.
```

#### 2. Get the Client Code (Git Sparse Checkout)
To download *only* the client code on your standalone client Pi Zero without downloading server code or large node packages, run these commands in your client Pi's SSH terminal to perform a highly efficient sparse checkout:
```bash
# Initialize a sparse repository locally on the client Pi
mkdir -p ~/trmnl-client && cd ~/trmnl-client
git init

# Add the remote repository URL
git remote add origin https://github.com/DerrickJEvans/trmnl-pi-server.git

# Configure git to only check out the client folder
git config core.sparseCheckout true
echo "client/*" >> .git/info/sparse-checkout

# Pull origin/main (this will only download the client folder!)
git pull origin main
```
This isolates the client files cleanly under `~/trmnl-client/client/`.

#### 3. Run the Automated Client Installer (`trmnl-client.sh`)
We have created a master client management script `trmnl-client.sh` to automate the entire process (installing dependencies, enabling hardware SPI, installing Waveshare drivers, setting up `.env` files, and registering systemd services) under a single interactive CLI.

To configure your client automatically, run:
```bash
cd ~/trmnl-client/client
chmod +x trmnl-client.sh
./trmnl-client.sh
```
* **Select Option `[1]` (Run Automated Client Setup/Installer)**.
* When prompted, enter your main TRMNL Server IP address (e.g. `192.168.1.122`).
* The installer will handle all package updates, enable SPI in `/boot/firmware/config.txt`, perform a low-RAM sparse install of Waveshare python drivers to prevent crashes, create a secure local `.env` configuration file, and spawn a persistent background service daemon (`trmnl-client.service`).

#### 4. Managing and Upgrading the Client
Your client is now fully active! You can use `trmnl-client.sh` anytime to manage operations:
* **Interactive Dashboard**: `./trmnl-client.sh` (opens the colorful control console)
* **Check live telemetry & connection diagnostics**: `./trmnl-client.sh status`
* **Stream real-time background logs**: `./trmnl-client.sh logs`
* **Safely pull code upgrades and restart services**: `./trmnl-client.sh update`



---

## 🐳 Simplified Deployment & Orchestration

To simplify provisioning and deploying new server and client displays, we have pre-packaged automated orchestration files. 

> [!NOTE]
> You can choose **either** a native bare-metal host deployment (Option 2) **or** a containerized sandboxed deployment (Option 1). They are separate paths—choose the one that best fits your server environment!

### 1. Multi-Container Dockerized Server & Local AI Deployment
You can deploy a new InkFlow E-Ink Server **and** a local, fully dedicated Ollama instance anywhere with a single command—no manual model downloading, Node.js installations, or compilation required!

* Ensure **Docker** and **Docker Compose** are installed on the host.
* Run this command in your server's root folder:
  ```bash
  docker compose up -d --build
  ```
* **What it does automatically:**
  1. Spins up the main **InkFlow server container** on port `5000`.
  2. Spawns an **interconnected Ollama container** in an isolated virtual bridge network.
  3. Binds and preserves your E-Ink caches (`cache/`), configurations (`config.json`), `.env` secrets, and LLM model files (`ollama-data` volume) persistently on the host.
  4. Allows the server to query local models by simply pointing `OLLAMA_HOST` in `.env` to `http://ollama:11434`.

### 2. Auto-Provisioning Server Installer & Safe Updater
If running a native Linux installation on your Raspberry Pi 5 server, the system handles Option B (Ollama) setup dynamically:
* **Fresh Installs (`install.sh`)**: Running `sudo ./install.sh` automatically installs Node dependencies, checks if Ollama is on the host, installs/enables it as a systemd service, pulls `llama3.2:1b`, and configures the default `.env` template.
* **Current Server Upgrades (`update.sh`)**: Running `./update.sh` on your active server automatically cleans local Git states, pulls new code, installs new npm dependencies, installs/enables Ollama on the host via `sudo`, pulls the `llama3.2:1b` model, appends the local `.env` keys, and restarts the backend daemons cleanly.

### 3. One-Line Client Bootstrapper (`client/setup_client.sh`)
Provisioning new Raspberry Pi Zero 2 W clients has been consolidated into a single piped command. 
* Flash a clean Raspberry Pi OS Lite image. SSH into your client.
* Run this command on the client (replacing `<server-ip>` with your actual server IP or local mDNS hostname):
  ```bash
  curl -sSL http://<server-ip>:5000/setup_client.sh | sudo bash
  ```
* **What it does automatically:**
  1. Installs all prerequisite system packages (SPI drivers, python3-pip, Git, PIL, NumPy).
  2. Enables hardware SPI interfaces in `/boot/config.txt` or `/boot/firmware/config.txt`.
  3. Orchestrates a memory-safe partial Git checkout of the Waveshare Python libraries to prevent 512MB RAM client crashes.
  4. Prompts you for the target server's address and updates `config.py`.
  5. Registers, enables, and boots up a persistent `trmnl-client.service` daemon background service.

---

## 🛡️ License

This project is released under the [MIT License](LICENSE) (MIT). Feel free to use, fork, modify, and integrate it into your custom low-power dashboard environments!

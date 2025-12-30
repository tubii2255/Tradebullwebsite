// Weekly Winner Data (later this comes from backend)
const weeklyWinner = {
    name: "Trader Raghav",
    pnl: "+₹18,450",
    percent: "+4.2%",
    style: "Price Action Scalping"
};

// Participants List
const participants = [
    { name: "Akhil", pnl: "+₹5,200" },
    { name: "Manoj", pnl: "-₹1,800" },
    { name: "Suresh", pnl: "+₹2,400" },
    { name: "Vishnu", pnl: "-₹650" },
    { name: "Rahul", pnl: "+₹980" }
];

function safeText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
}

// Inject Winner (use textContent to avoid XSS)
safeText("winnerName", weeklyWinner.name);
safeText("winnerPnl", weeklyWinner.pnl);
safeText("winnerPercent", weeklyWinner.percent);
safeText("winnerStyle", weeklyWinner.style);

// Inject Participants
const list = document.getElementById("participantList");

if (list) {
    if (participants.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No participants yet.';
        list.appendChild(li);
    } else {
        participants.forEach(trader => {
            const li = document.createElement('li');
            li.textContent = `${trader.name} — ${trader.pnl}`;
            list.appendChild(li);
        });
    }
}

// Helper: If in future you receive raw numbers, format them here.
function formatCurrency(amount) {
    // Placeholder: expects a pre-formatted string like "+₹1,234". Implement parsing if needed.
    return amount;
}

// Hamburger Menu Toggle
const hamburger = document.querySelector('.hamburger');
const navLinks = document.querySelector('.nav-links');

if (hamburger && navLinks) {
    // Toggle menu on hamburger click
    hamburger.addEventListener('click', () => {
        const isActive = navLinks.classList.toggle('active');
        hamburger.classList.toggle('active');
        hamburger.setAttribute('aria-expanded', isActive);
    });

    // Close menu when clicking on any link
    const menuLinks = navLinks.querySelectorAll('a');
    menuLinks.forEach(link => {
        link.addEventListener('click', () => {
            navLinks.classList.remove('active');
            hamburger.classList.remove('active');
            hamburger.setAttribute('aria-expanded', 'false');
        });
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!hamburger.contains(e.target) && !navLinks.contains(e.target)) {
            if (navLinks.classList.contains('active')) {
                navLinks.classList.remove('active');
                hamburger.classList.remove('active');
                hamburger.setAttribute('aria-expanded', 'false');
            }
        }
    });
}

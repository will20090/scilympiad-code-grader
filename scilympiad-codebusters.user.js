// ==UserScript==
// @name         Scilympiad Codebusters Autograder
// @namespace    http://tampermonkey.net/
// @version      2.2
// @match        https://scilympiad.com/*/ES/GradeTeams*
// @match        https://scilympiad.com/*/ES/GradeTeam*
// @match        https://scilympiad.com/*/Es/GradeTeams*
// @match        https://scilympiad.com/*/Es/GradeTeam*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const TIER_POINTS = { 0: 0, 1: 150, 2: 400, 3: 750 };

    function isRunning() {
        return localStorage.getItem('cb_auto_run') === 'true';
    }

    // --- VIEW 1: MAIN HOMESCREEN (GradeTeams) ---
    if (window.location.href.includes('GradeTeams')) {
        window.addEventListener('load', () => {
            const toolbar = document.querySelector('.row') || document.body;
            const panel = document.createElement('div');
            panel.style.cssText = 'margin: 15px 0; padding: 12px; background: #e8f0fe; border: 2px solid #4285F4; border-radius: 6px; font-family: sans-serif;';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.style.cssText = 'padding: 10px 18px; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;';

            const statusSpan = document.createElement('span');
            statusSpan.style.cssText = 'margin-left: 12px; font-weight: bold; color: #202124;';

            function updateUI() {
                if (isRunning()) {
                    btn.innerText = 'Pause';
                    btn.style.background = '#d93025';
                    statusSpan.innerText = 'Status: RUNNING (Scanning for next team...)';
                } else {
                    btn.innerText = 'start';
                    btn.style.background = '#188038';
                    statusSpan.innerText = 'Status: Paused';
                }
            }

            btn.onclick = () => {
                const nextState = !isRunning();
                localStorage.setItem('cb_auto_run', nextState ? 'true' : 'false');
                updateUI();
                if (nextState) checkAndProceed();
            };

            panel.appendChild(btn);
            panel.appendChild(statusSpan);
            toolbar.prepend(panel);
            updateUI();

            function checkAndProceed() {
                if (!isRunning()) return;

                const rows = document.querySelectorAll('tr, div');
                let targetLink = null;

                for (const row of rows) {
                    const btnElem = Array.from(row.querySelectorAll('a, button'))
                        .find(el => (el.innerText || '').trim() === 'Grade this');
                    if (btnElem) {
                        targetLink = btnElem;
                        break;
                    }
                }

                if (targetLink) {
                    statusSpan.innerText = 'Status: Found pending team. Entering test...';
                    setTimeout(() => targetLink.click(), 600);
                } else {
                    statusSpan.innerText = 'Status: All teams graded! Auto-run finished.';
                    localStorage.setItem('cb_auto_run', 'false');
                    updateUI();
                }
            }

            if (isRunning()) {
                setTimeout(checkAndProceed, 1500);
            }
        });
        return;
    }

    // --- VIEW 2: INSIDE A TEAM'S TEST PAGE (GradeTeam) ---
    if (window.location.href.includes('GradeTeam')) {
        let hasExecuted = false;

        const observer = setInterval(() => {
            if (!isRunning() || hasExecuted) return;

            if (document.body.innerText.includes('Expected Answer:') || document.body.innerText.includes('Student Answer:')) {
                hasExecuted = true;
                clearInterval(observer);
                runTestGrader();
            }
        }, 400);

        function runTestGrader() {
            const box = document.createElement('div');
            box.style.cssText = 'position: fixed; top: 15px; right: 15px; z-index: 99999; padding: 15px; background: white; border: 3px solid #188038; border-radius: 8px; font-family: sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.2); max-width: 320px;';
            box.innerHTML = `<strong>Grading</strong><div id="cb-status" style="margin-top: 6px; font-size: 13px; color: #5f6368;">wait</div>`;
            document.body.appendChild(box);
            const statusDiv = document.getElementById('cb-status');

            try {
                // Find all question sections that contain special bonus keywords
                const questionDivs = Array.from(document.querySelectorAll('div, tr, section')).filter(el => {
                    const txt = el.innerText || '';
                    return txt.includes('Expected Answer:') && (txt.includes('SPECIAL') || txt.includes('special'));
                });

                statusDiv.innerText = `Found ${questionDivs.length} special questions. Evaluating points...`;

                let solvedCount = 0;

                for (const block of questionDivs) {
                    const blockText = block.innerText;
                    if (blockText.includes("Team did NOT answer this")) continue;

                    // Extract max points for this question (e.g., "7. (434.00 pts)")
                    const maxPtsMatch = blockText.match(/\([\d,.]+\s*pts\)/i);
                    const maxPts = maxPtsMatch ? parseFloat(maxPtsMatch[0].replace(/[^0-9.]/g, '')) : 0;

                    // Find the points input box or awarded points label inside this question block
                    const ptsInput = block.querySelector('input[type="text"], input[type="number"]');
                    const awardedLabel = block.innerText.match(/(?:Awarded points|ES awarded points):\s*([\d,.]+)/i);

                    let awardedPts = 0;
                    if (ptsInput && ptsInput.value.trim() !== '') {
                        awardedPts = parseFloat(ptsInput.value) || 0;
                    } else if (awardedLabel) {
                        awardedPts = parseFloat(awardedLabel[1]) || 0;
                    }

                    // If the student received more than 0 points (meaning they got credit despite any allowed errors), count it as solved
                    if (maxPts > 0 && awardedPts > 0) {
                        solvedCount++;
                    }
                }

                statusDiv.innerText = `${solvedCount}/3 sb solved`;

                // Find the final summary question input box
                const allInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="number"]'));
                const finalInput = allInputs[allInputs.length - 1];

                if (finalInput) {
                    const targetPoints = TIER_POINTS[solvedCount] ?? 0;
                    finalInput.value = targetPoints;
                    finalInput.dispatchEvent(new Event('input', { bubbles: true }));
                    finalInput.dispatchEvent(new Event('change', { bubbles: true }));

                    statusDiv.innerText = `Assigned ${targetPoints} pts. Saving...`;

                    // Click corresponding save/change points button
                    const parentContainer = finalInput.closest('div, tr, form') || document.body;
                    const saveBtn = Array.from(parentContainer.querySelectorAll('button, input[type="submit"], input[type="button"]'))
                        .find(b => (b.innerText || b.value || '').toLowerCase().includes('points'));

                    if (saveBtn) saveBtn.click();

                    // Click "Done grading" to return to lobby
                    setTimeout(() => {
                        const doneBtn = Array.from(document.querySelectorAll('a, button'))
                            .find(el => (el.innerText || '').toLowerCase().includes('done grading'));

                        if (doneBtn) {
                            statusDiv.innerText = "Done11!1!";
                            setTimeout(() => doneBtn.click(), 800);
                        } else {
                            statusDiv.innerText = "Click 'Done grading' manually.";
                        }
                    }, 1000);

                } else {
                    statusDiv.innerText = "Could not find final points input box.";
                }

            } catch (err) {
                statusDiv.innerHTML = `<span style="color:red;">Error: ${err.message}</span><br>Paused.`;
                localStorage.setItem('cb_auto_run', 'false');
            }
        }
    }

})();

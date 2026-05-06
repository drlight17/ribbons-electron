export function updateDateTime(locale) {
    const now = new Date();

    const dateOptions = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
    const formattedDate = now.toLocaleDateString(locale, dateOptions);

    const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const formattedTime = now.toLocaleTimeString(locale, timeOptions);

    document.getElementById('currentDate').textContent = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);
    document.getElementById('currentTime').textContent = formattedTime;
}

export function showDateTime() {
    document.getElementsByClassName('datetime-container')[0].classList.remove('hidden');
}

export function setFront(){
    document.getElementsByClassName('datetime-container')[0].classList.add('front');
}

function toggleAnimation(element) {
    element.classList.remove('appear-disappear-1', 'appear-disappear-2');

    void element.offsetWidth; // Critical browser reflow trigger

    const nextClass = Math.random() < 0.5 
    ? 'appear-disappear-1' 
    : 'appear-disappear-2';

    element.classList.add(nextClass);
    // set randomize datetime animation duration

    // Randomize duration for EACH element (10-30s)
    let dur_base = Math.floor(Math.random() * 21) + 10;

    let dur = `${dur_base}s`

    element.style.setProperty('--dur', dur);

    if (nextClass == 'appear-disappear-1') {
        //console.log(`Zooming in animation. Remove front now. Waiting ${dur_base * 0.5}s`)
        element.classList.remove('front'); // Immediate removal (0%)
        setTimeout(() => {
            //console.log(`Zooming in animation. Add front`)
            element.classList.add('front');
        }, dur_base * 0.5 * 1000);
    } else {
        //console.log(`Zooming out animation. Add front now. Waiting ${dur_base * 0.5}s`)
        element.classList.add('front'); // Immediate addition (0%)
        setTimeout(() => {
            //console.log(`Zooming out animation. Remove front`)
            element.classList.remove('front');
        }, dur_base * 0.5 * 1000);
    }
}


function getActiveAnimations(element) {

    const computedStyle = window.getComputedStyle(element);
    const animations = [];
    
    // Get all active animations
    
    for (let i = 0; i < element.getAnimations().length; i++) {

        const anim = element.getAnimations()[i];
        if (anim.playState === 'running') {
            animations.push(anim);
        }
    }
    
    return animations.length > 0;
}

export function randomizePosition(bounds) {

    
    let element = document.getElementsByClassName('datetime-container')[0];

    // Check if animation is already running
    if (getActiveAnimations(element)) {
        //console.log("Animation is currently running. Skip new run!");
        return; // Skip if animation is active
    }

    let { left, top } = getRandomPosition(bounds, 10, 500);


    /*if (Math.random() > 0.5) {
        element.classList.toggle('front');
    }*/

    element.style.top = top;
    element.style.left = left;
    toggleAnimation(element);

}

let lastPosition = null;

function getRandomPosition(bounds) {
  const padding = 0.15; // % padding
  const px_padding = 300;
  const w = bounds.width;
  const h = bounds.height;
  const minDistance = 0.5 * Math.min(w, h);
  const maxAttempts = 50;
  let distance;
  
  let left, top;
  
  do {
    left = Math.round(Math.random() * (w * (1 - 2 * padding))/* + w * padding - px_padding*/);
    top = Math.round(Math.random() * (h * (1 - 2 * padding))/* + h * padding - px_padding*/);
    
    if (lastPosition) {
      const dx = left - lastPosition.left ;
      const dy = top - lastPosition.top;
      distance = Math.sqrt(dx * dx + dy * dy);
      
    } else {
      break; // first run - skip
    }
    
  } while ((distance < minDistance) && (left < w * padding) && (top < h * padding));
  
  lastPosition = { left, top };

  console.log(`left: ${left}, top: ${top}`)

  return { left, top };
}
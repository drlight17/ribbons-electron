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

    // set randomize datetime animation duration

    // Randomize duration for EACH element (30-60s)
    document.querySelectorAll('.appear-disappear-1').forEach(el => {
        el.style.setProperty('--dur', `${Math.random() * 30 + 30}s`);
    });
    document.querySelectorAll('.appear-disappear-2').forEach(el => {
        el.style.setProperty('--dur', `${Math.random() * 30 + 30}s`);
    });

    let { left, top } = getRandomPosition(bounds, 20, 400);

    if (Math.random() > 0.5) {
        element.classList.toggle('front');
    }
    element.style.top = top;
    element.style.left = left;
    toggleAnimation(element);

}



let lastPosition = null;

function getRandomPosition(bounds, paddingPercentage = 10, minDistance = 200) {
    const paddingX = bounds.width * (paddingPercentage / 100);
    const paddingY = bounds.height * (paddingPercentage / 100);
    
    const maxWidth = Math.max(0, bounds.width - paddingX * 2);
    const maxHeight = Math.max(0, bounds.height - paddingY * 2);
    
    let left, top;
    let attempts = 0;
    const maxAttempts = 50; // Prevent infinite loops
    
    do {
        left = Math.floor(Math.random() * maxWidth) + paddingX;
        top = Math.floor(Math.random() * maxHeight) + paddingY;
        
        // Check distance from last position if it exists
        if (lastPosition && attempts < maxAttempts) {
            const distance = Math.sqrt(
                Math.pow(left - lastPosition.left, 2) + 
                Math.pow(top - lastPosition.top, 2)
            );
            
            if (distance >= minDistance) {
                break; // Acceptable distance
            }
        } else if (!lastPosition) {
            break; // First call, always accept
        }
        
        attempts++;
    } while (attempts < maxAttempts);
    
    // Update last position
    lastPosition = { left, top };

    console.log(`left: ${left}, top: ${top}`)

    return { left, top };
}
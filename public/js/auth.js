/* ── auth.js — Login / Register page logic ── */

let selectedRole = 'passenger';
let currentTab = 'login';

function switchTab(tab) {
  currentTab = tab;
  const loginPanel    = document.getElementById('loginPanel');
  const registerPanel = document.getElementById('registerPanel');
  const loginTab      = document.getElementById('loginTab');
  const registerTab   = document.getElementById('registerTab');
  const switchText    = document.getElementById('switchText');

  if (tab === 'login') {
    loginPanel.style.display = '';
    registerPanel.style.display = 'none';
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
    switchText.innerHTML = `Don't have an account? <a href="#" onclick="switchTab('register');return false;">Sign up</a>`;
  } else {
    loginPanel.style.display = 'none';
    registerPanel.style.display = '';
    loginTab.classList.remove('active');
    registerTab.classList.add('active');
    switchText.innerHTML = `Already have an account? <a href="#" onclick="switchTab('login');return false;">Log in</a>`;
  }
}

function selectRole(role) {
  selectedRole = role;
  document.getElementById('selectedRole').value = role;
  document.getElementById('rolePassenger').classList.toggle('selected', role === 'passenger');
  document.getElementById('roleDriver').classList.toggle('selected', role === 'driver');
  const driverFields = document.getElementById('driverFields');
  driverFields.style.display = role === 'driver' ? 'flex' : 'none';
  driverFields.style.flexDirection = 'column';
  driverFields.style.gap = '16px';
}

async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  const btn      = document.getElementById('loginBtn');
  const btnText  = document.getElementById('loginBtnText');
  const spinner  = document.getElementById('loginSpinner');

  errEl.style.display = 'none';
  btnText.style.display = 'none';
  spinner.style.display = 'block';
  btn.disabled = true;

  try {
    const data = await api.login(email, password);
    setAuth(data.token, data.user);
    showToast('success', 'Welcome back!', `Hello, ${data.user.name.split(' ')[0]}!`);
    setTimeout(() => redirectByRole(data.user.role), 800);
  } catch (err) {
    if (err.status === 403 && (err.message || '').includes('Phone number not verified')) {
      showToast('warning', 'Verification Required', 'A verification OTP has been sent.');
      localStorage.setItem('velora_verify_email', email);
      if (err.devOtp) localStorage.setItem('velora_dev_otp', err.devOtp);
      setTimeout(() => window.location.href = '/verify.html', 1200);
    } else {
      errEl.textContent = err.message || 'Login failed. Please try again.';
      errEl.style.display = 'block';
    }
  } finally {
    btnText.style.display = 'inline';
    spinner.style.display = 'none';
    btn.disabled = false;
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name     = document.getElementById('regName').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const phone    = document.getElementById('regPhone').value.trim();
  const password = document.getElementById('regPassword').value;
  const role     = document.getElementById('selectedRole').value || 'passenger';
  const vehicle  = document.getElementById('regVehicle')?.value.trim();
  const plate    = document.getElementById('regPlate')?.value.trim();
  const errEl    = document.getElementById('registerError');
  const btn      = document.getElementById('registerBtn');
  const btnText  = document.getElementById('registerBtnText');
  const spinner  = document.getElementById('registerSpinner');

  errEl.style.display = 'none';
  btnText.style.display = 'none';
  spinner.style.display = 'block';
  btn.disabled = true;

  try {
    const body = { name, email, password, role, phone };
    if (role === 'driver') { body.vehicle_info = vehicle; body.license_plate = plate; }
    const data = await api.register(body);
    
    // Save email and devOtp (if present in demo mode)
    localStorage.setItem('velora_verify_email', email);
    if (data.devOtp) localStorage.setItem('velora_dev_otp', data.devOtp);
    
    showToast('success', 'Account created!', 'Please enter the verification code sent to your phone.');
    setTimeout(() => window.location.href = '/verify.html', 1200);
  } catch (err) {
    errEl.textContent = err.message || 'Registration failed. Please try again.';
    errEl.style.display = 'block';
  } finally {
    btnText.style.display = 'inline';
    spinner.style.display = 'none';
    btn.disabled = false;
  }
}

function redirectByRole(role) {
  if (role === 'driver') window.location.href = '/driver.html';
  else if (role === 'admin') window.location.href = '/admin.html';
  else window.location.href = '/dashboard.html';
}

async function demoLogin(email, password) {
  document.getElementById('loginEmail').value = email;
  document.getElementById('loginPassword').value = password;
  switchTab('login');
  await handleLogin({ preventDefault: () => {} });
}

// Check if already logged in
(function init() {
  const token = getToken();
  const user  = getUser();
  if (token && user) redirectByRole(user.role);

  // Check hash for pre-selecting tab
  if (window.location.hash.includes('register')) switchTab('register');

  // Set min date/time for departure inputs
  const now = new Date();
  now.setMinutes(now.getMinutes() + 30);
})();

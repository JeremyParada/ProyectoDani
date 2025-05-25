// script.js
function cambiarVista() {
  const registerForm = document.getElementById('registerForm');
  const loginForm = document.getElementById('loginForm');
  
  if (registerForm.style.display === 'none') {
    registerForm.style.display = 'flex';
    loginForm.style.display = 'none';
    document.querySelector('h2').textContent = 'Registro';
  } else {
    registerForm.style.display = 'none';
    loginForm.style.display = 'flex';
    document.querySelector('h2').textContent = 'Inicio Sesión';
  }
}

document.getElementById('registerForm').addEventListener('submit', async function (e) {
  e.preventDefault();

  const nombre = document.getElementById('nombre').value;
  const apellido = document.getElementById('apellido').value;
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  if (password.length < 7 || !/\d/.test(password) || !/[a-zA-Z]/.test(password)) {
    alert("La contraseña no cumple los requisitos.");
    return;
  }

  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: `${nombre} ${apellido}`,
        email,
        password
      })
    });

    const data = await response.json();
    
    if (response.ok) {
      alert('Registro exitoso. Por favor inicie sesión.');
      cambiarVista(); // Switch to login view
    } else {
      alert(`Error: ${data.message}`);
    }
  } catch (error) {
    console.error('Error durante el registro:', error);
    alert('Error de conexión. Intente nuevamente.');
  }
});

// Add login form handler
function addLoginForm() {
  const loginFormHTML = `
  <form id="loginForm" style="display:none;">
    <input type="email" id="loginEmail" placeholder="Correo Electrónico" required />
    <input type="password" id="loginPassword" placeholder="Contraseña" required />
    <button type="submit" class="btn">Iniciar Sesión</button>
    <button type="button" class="btn secondary" onclick="cambiarVista()">Crear Cuenta</button>
  </form>
  `;
  
  document.querySelector('.right-section').insertAdjacentHTML('beforeend', loginFormHTML);
  
  document.getElementById('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          password
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        // Store token in localStorage
        localStorage.setItem('token', data.token);
        alert('Inicio de sesión exitoso');
        window.location.href = '/dashboard.html'; // Redirect to dashboard
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (error) {
      console.error('Error durante el inicio de sesión:', error);
      alert('Error de conexión. Intente nuevamente.');
    }
  });
}

// Run when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  addLoginForm();
});
// Function to clear the form inputs without submitting the form
function clearForm() {
  var form = document.getElementById("inputForm");
  var div_result = document.getElementById("result_div");
  var form_fields = document.getElementById("form_elements")
  form.reset(); // Reset all the input fields in the form
  sessionStorage.removeItem("ip_address");

  var Div = document.getElementById("snmp_fields");
  Div.style.display = "none"; // Hide SNMPv2c fields
  div_result.style.display = "none";
  form_fields.style.display = "block";
};
function toggleSNMPFields() {
  const snmpFields = document.getElementById("snmp_fields");
  const snmpCheckbox = document.getElementById("snmp_walk");
  if (snmpCheckbox.checked) {
    snmpFields.style.display = "block";
  } else {
    snmpFields.style.display = "none";
  }
};

// Function to toggle SNMP version-specific fields
function toggleSNMPVersionFields() {
  var snmpVersion = document.getElementById("snmp_version").value;
  var v3Div_1 = document.getElementById("v3_1");
  var v3Div_2 = document.getElementById("v3_2");
  var v3Div_3 = document.getElementById("v3_3");
  var v3Div_4 = document.getElementById("v3_4");
  var v3Div_5 = document.getElementById("v3_5");
  var v3Div_6 = document.getElementById("v3_6");
  var v3Div_7 = document.getElementById("v3_7");

  var vv2cv3_1 = document.getElementById("v2cv3_1");
  var vv2cv3_2 = document.getElementById("v2cv3_2");

  if (snmpVersion === "2c" || snmpVersion === "3") {
    vv2cv3_1.style.display = "block";
    vv2cv3_2.style.display = "block";
  } else {
    vv2cv3_1.style.display = "none";
    vv2cv3_2.style.display = "none";
  }
  if (snmpVersion === "3") {
    v3Div_1.style.display = "block";
    v3Div_2.style.display = "block";
    v3Div_3.style.display = "block";
    v3Div_4.style.display = "block";
    v3Div_5.style.display = "block";
    v3Div_6.style.display = "block";
    v3Div_7.style.display = "block";
  } else {
    v3Div_1.style.display = "none";
    v3Div_2.style.display = "none";
    v3Div_3.style.display = "none";
    v3Div_4.style.display = "none";
    v3Div_5.style.display = "none";
    v3Div_6.style.display = "none";
    v3Div_7.style.display = "none";
  }
};

// Ensure the correct fields are visible on page load
window.onload = function () {
  toggleSNMPVersionFields();
};
// JavaScript for the "Select All" checkbox functionality
function toggleSelectAll() {
  const selectAll = document.getElementById("selectAll");
  const checkboxes = document.querySelectorAll(".operation-checkbox");
  checkboxes.forEach(function (checkbox) {
    if (checkbox !== selectAll) {
      checkbox.checked = selectAll.checked;
    }
  });
};

// save in local storage
// Load form data from sessionStorage on page load
window.onload = function () {
  if (sessionStorage.getItem("ip_address")) {
    document.getElementById("ipAddress").value =
      sessionStorage.getItem("ip_address");
    // document.getElementById("ipAddress1").value =
    //   sessionStorage.getItem("ip_address1");
  }
  document.getElementById("snmp_version").dispatchEvent(new Event("change"));
};

// Save form data to sessionStorage when user types in the fields
document.getElementById("inputForm").addEventListener("input", function () {
  sessionStorage.setItem(
    "ip_address",
    document.getElementById("ipAddress").value,
  );
  // sessionStorage.setItem(
  //   "ip_address1",
  //   document.getElementById("ipAddress1").value,
  // );
});
// Get form and spinner elements
const form = document.getElementById("inputForm");
const spinnerOverlay = document.getElementById("spinnerOverlay");

// Add event listener for form submission
form.addEventListener("submit", function () {
  // Show the spinner
  spinnerOverlay.style.display = "flex";

  // Optional: Ensure the form is not resubmitted
  form.querySelector('button[type="submit"]').disabled = true;
});
const oidInput = document.getElementById("oid");
const oidSelect = document.getElementById("oid-select");

// Update input field when dropdown changes
oidSelect.addEventListener("change", function () {
  oidInput.value = this.value;
});

// Update dropdown when input changes (if the input matches a known value)
oidInput.addEventListener("input", function () {
  const matchingOption = Array.from(oidSelect.options).find(
    (option) => option.value === this.value,
  );
  if (matchingOption) {
    oidSelect.value = matchingOption.value;
  } else {
    oidSelect.value = ""; // Clear selection if no match
  }
});
// Function to toggle dropdown visibility
function toggleDropdown() {
  const dropdown = document.getElementById("dropdown");
  dropdown.style.display =
    dropdown.style.display === "block" ? "none" : "block";
};

// Function to show the popup
function showPopup() {
  const popup = document.getElementById("popup");
  popup.style.display = "block";
};

// Function to close the popup
function closePopup() {
  const popup = document.getElementById("popup");
  popup.style.display = "none";
};

// Close the dropdown if clicked outside
document.addEventListener("click", function (event) {
  const dropdown = document.getElementById("dropdown");
  const navbarIcon = document.querySelector(".navbar-icon");

  if (!dropdown.contains(event.target) && !navbarIcon.contains(event.target)) {
    dropdown.style.display = "none";
  }
});

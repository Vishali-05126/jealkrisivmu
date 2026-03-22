/**
 * Donor Eligibility + Ranking Utilities
 * Safety-first rules for blood donation matching
 */

class DonorEligibility {
  static CRITICAL_DISEASES = ['hiv', 'hepatitis b', 'hepatitis c', 'cancer'];

  // Donor -> recipient compatibility
  static COMPATIBILITY = {
    'O-': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
    'O+': ['O+', 'A+', 'B+', 'AB+'],
    'A-': ['A-', 'A+', 'AB-', 'AB+'],
    'A+': ['A+', 'AB+'],
    'B-': ['B-', 'B+', 'AB-', 'AB+'],
    'B+': ['B+', 'AB+'],
    'AB-': ['AB-', 'AB+'],
    'AB+': ['AB+'],
  };

  static normalizeStr(value) {
    return (value || '').toString().trim().toLowerCase();
  }

  static clamp01(value) {
    if (Number.isNaN(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  static normalizeTrustScore(score) {
    if (score === undefined || score === null) return 0.8;
    const num = Number(score);
    if (Number.isNaN(num)) return 0.8;
    // Support both 0-1 and 0-5 scales
    return this.clamp01(num > 1 ? num / 5 : num);
  }

  static getHealthScore(hemoglobin) {
    const hb = Number(hemoglobin);
    if (Number.isNaN(hb) || hb <= 0) return 0.8;
    return this.clamp01(hb / 15);
  }

  /**
   * Calculate days since last donation
   * @param {Date|string} lastDate - Last donation date
   * @returns {number} Days since last donation
   */
  static daysSinceLastDonation(lastDate) {
    if (!lastDate) return Infinity;
    const today = new Date();
    const last = new Date(lastDate);
    if (Number.isNaN(last.getTime())) return Infinity;
    const diffTime = today - last;
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Blood compatibility check
   * @param {string} donorType
   * @param {string} recipientType
   * @returns {boolean}
   */
  static isCompatible(donorType, recipientType) {
    const d = (donorType || '').toUpperCase();
    const r = (recipientType || '').toUpperCase();
    const allowed = this.COMPATIBILITY[d];
    if (!allowed) return false;
    return allowed.includes(r);
  }

  /**
   * Determine if donor should be visible in UI
   * @param {string} eligibility
   * @param {boolean} isEmergency
   * @returns {boolean}
   */
  static shouldShowDonor(eligibility, isEmergency) {
    if (eligibility === 'ELIGIBLE') return true;
    if (isEmergency && eligibility === 'EMERGENCY_ELIGIBLE') return true;
    return false;
  }

  /**
   * Calculate donor score for ranking
   * @param {Object} donor - Donor data
   * @param {Object} request - Request data (bloodType, location, isEmergency)
   * @returns {number} Score between 0-1
   */
  static calculateScore(donor, request) {
    const compatibility = this.isCompatible(donor.bloodType, request.bloodType) ? 1 : 0;
    const distanceKm = Math.max(0.5, Number(donor.distance) || 9999);
    const distanceScore = 1 / distanceKm;
    const trustScore = this.normalizeTrustScore(donor.trustScore);
    const healthScore = this.getHealthScore(donor.hemoglobin);

    return (
      0.35 * compatibility +
      0.2 * distanceScore +
      0.2 * trustScore +
      0.25 * healthScore
    );
  }

  /**
   * Evaluate donor eligibility
   * @param {Object} donor - Donor data
   * @param {boolean} isEmergency - Whether it's an emergency situation
   * @returns {Object} Eligibility result
   */
  static evaluate(donor, isEmergency = false) {
    const {
      lastDonation,
      lastDonationDate,
      diseases = [],
      hemoglobin,
      isAvailable,
      status,
    } = donor;

    const lastDonationDays = this.daysSinceLastDonation(lastDonation || lastDonationDate);

    const diseaseArray = Array.isArray(diseases) ? diseases : (diseases ? [diseases] : []);
    const diseaseList = diseaseArray.map(this.normalizeStr);
    const hasCriticalDisease = diseaseList.some(disease =>
      this.CRITICAL_DISEASES.includes(disease)
    );

    const hb = Number(hemoglobin);
    const lowHemoglobin = !Number.isNaN(hb) && hb < 12;

    const availabilityStatus = status || (isAvailable === false ? 'offline' : 'available');
    const availableNow = availabilityStatus === 'available' && isAvailable !== false;

    let eligibility = 'NOT_ELIGIBLE';
    let reason = 'Donor does not meet eligibility criteria';
    let daysRemaining = null;
    let riskLevel = 'HIGH';

    if (hasCriticalDisease) {
      reason = 'Donor has critical disease(s) that prevent donation';
    } else if (lowHemoglobin) {
      reason = 'Hemoglobin level too low for donation';
    } else if (!availableNow) {
      reason = 'Donor is not currently available';
    } else if (lastDonationDays >= 90) {
      eligibility = 'ELIGIBLE';
      reason = 'Healthy donor with sufficient recovery time';
      riskLevel = 'LOW';
      daysRemaining = 0;
    } else if (isEmergency && lastDonationDays >= 30) {
      eligibility = 'EMERGENCY_ELIGIBLE';
      reason = 'Emergency case allows donation after 30 days';
      riskLevel = 'MEDIUM';
      daysRemaining = 0;
    } else {
      const requiredDays = isEmergency ? 30 : 90;
      daysRemaining = Math.max(0, requiredDays - lastDonationDays);
      reason = `Donor gave blood ${lastDonationDays} days ago, minimum required is ${requiredDays} days`;
    }

    return {
      eligibility,
      reason,
      daysRemaining,
      riskLevel,
      showInList: this.shouldShowDonor(eligibility, isEmergency),
    };
  }

  /**
   * Filter and rank donors for a blood request
   * @param {Array} donors - Array of donor objects
   * @param {Object} request - Request data (bloodType, location, isEmergency)
   * @returns {Array} Filtered and ranked donors
   */
  static filterAndRankDonors(donors, request = {}) {
    const { isEmergency = false } = request;

    const evaluated = donors.map(donor => {
      const eligibility = this.evaluate(donor, isEmergency);
      const daysSinceLastDonation = this.daysSinceLastDonation(
        donor.lastDonation || donor.lastDonationDate
      );
      const score = this.calculateScore(donor, request);
      return {
        ...donor,
        eligibility,
        daysSinceLastDonation,
        score,
      };
    });

    const compatible = evaluated.filter(donor =>
      this.isCompatible(donor.bloodType, request.bloodType)
    );

    return compatible
      .filter(donor => donor.eligibility.showInList)
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Emergency expansion: if no donors found, expand search
   * @param {Array} donors - Initial donor list
   * @param {Object} request - Request data
   * @param {number} initialRadius - Initial search radius (km)
   * @returns {Object} Expanded results
   */
  static emergencyExpansion(donors, request, initialRadius = 10) {
    let visibleDonors = this.filterAndRankDonors(donors, { ...request, isEmergency: false });
    let radius = initialRadius;
    let expanded = false;

    if (visibleDonors.length === 0 && request.isEmergency) {
      expanded = true;
      radius += 10;
      visibleDonors = this.filterAndRankDonors(donors, { ...request, isEmergency: true });
    }

    return { donors: visibleDonors, radius, expanded };
  }
}

module.exports = DonorEligibility;

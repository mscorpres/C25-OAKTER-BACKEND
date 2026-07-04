<?php
    date_default_timezone_set('Asia/Kolkata');
    
    define('DB_OAKTER_HOST',"138.201.35.175"); 
    define('DB_OAKTER_USER',"msc_ims_user");
    define('DB_OAKTER_PASS',"a9vLc4/&@DgKN1>A");
    
    define('DB_OAKTER_INVT', 'alwar_oakter_ims_invt');
    define('DB_OAKTER_TALLY', 'alwar_oakter_ims_tally');
    
    // Establish DB Connection
    
    try {
        $con = new PDO("mysql:host=" . DB_OAKTER_HOST . ";charset=UTF8;dbname=" . DB_OAKTER_INVT, DB_OAKTER_USER, DB_OAKTER_PASS);
    } catch (PDOException $e) {
        echo 'We are not able to connect Inventory';
        exit;
    }
    
     try {
        $con_tally = new PDO("mysql:host=" . DB_OAKTER_HOST . ";charset=UTF8;dbname=" . DB_OAKTER_TALLY, DB_OAKTER_USER, DB_OAKTER_PASS);
    } catch (PDOException $e) {
        echo 'We are not able to connect Inventory';
        exit;
    }
?>
